import 'server-only';

/**
 * Starting a vendor render: voice for one dialogue line or a whole episode
 * (ElevenLabs TTS through the voice queue), and music or SFX for one audio
 * cue (the `audio-file-generation` job). The web's actions and the MCP
 * render tools (FILM-1909) call these with the caller's client: the cookie
 * session on the web, the principal's RLS client over MCP. Either way the
 * same checks run: the target must be writable (`authorizeEpisodeTarget`,
 * KB-31, KB-46, KB-47), voices must be assigned, and the worker bills and
 * renders with the target account's own ElevenLabs key. No model is called.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { ActionRefusal } from '@kit/next/action-result';
import { requireAffectedRows } from '@kit/next/refusals';
import { AudioCueTypeSchema } from '@kit/prompt-engine/llm-job-payloads';
import { authorizeEpisodeTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import { readFailed, whyNoRow } from '@kit/shared/rows';
import type { Database } from '@kit/supabase/database';

import type {
  BatchGenerateDialogueResult,
  BatchGenerateDialogueSchemaType,
  VoiceAssignment,
} from '../lib/schemas/batch.schema';
import type { GenerateDialogueVoiceSchemaType } from '../lib/schemas/voice-action.schema';
import { estimateVoiceCost } from '../lib/voice-utils';
import { getProjectTTSModel } from './project-audio-settings';
import { getVoiceIdForCharacter, getVoiceSettings } from './voice-queries';
import { queueVoiceJobs } from './voice-queue-helper';

type Client = SupabaseClient<Database>;

export interface RenderStart {
  success: boolean;
  status: 'queued' | 'failed';
  error?: string;
}

interface DialogueLineResponse {
  id: string;
  episode_id: string;
  text: string;
  character_asset_id: string | null;
  audio_url: string | null;
  status: string;
}

export interface DialogueLineForBatch {
  id: string;
  episode_id: string;
  character_asset_id: string | null;
  text: string;
  audio_url: string | null;
  status: string;
  sequence_number: number;
}

/**
 * Build voice assignments for all characters in dialogue lines
 * Merges user-provided assignments with character voice profiles
 */
export async function buildVoiceAssignments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  dialogueLines: DialogueLineForBatch[],
  userAssignments?: Record<string, VoiceAssignment>,
): Promise<Record<string, VoiceAssignment>> {
  const assignments: Record<string, VoiceAssignment> = { ...userAssignments };

  // Get unique character IDs that don't have user-provided assignments
  const characterIds = [
    ...new Set(
      dialogueLines
        .map((line) => line.character_asset_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  const missingCharacters = characterIds.filter((id) => !assignments[id]);

  if (missingCharacters.length === 0) {
    return assignments;
  }

  // Batch-fetch all voice IDs in a single query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: charDetails } = await (client as any)
    .from('character_details')
    .select('asset_id, elevenlabs_voice_id')
    .in('asset_id', missingCharacters);

  // getVoiceSettings returns static defaults, so no per-character query needed
  const defaultSettings = await getVoiceSettings(client, null);

  for (const detail of charDetails ?? []) {
    if (detail.elevenlabs_voice_id) {
      assignments[detail.asset_id] = {
        voiceId: detail.elevenlabs_voice_id,
        settings: defaultSettings,
      };
    }
  }

  return assignments;
}

/**
 * Voice for one dialogue line, queued for the voice worker. The line is
 * marked generating first and put back to pending if the queue refuses.
 */
export async function startDialogueVoiceRender(
  client: Client,
  userId: string,
  data: GenerateDialogueVoiceSchemaType,
): Promise<RenderStart> {
  const logger = await getLogger();
  const ctx = {
    name: 'voice.generateDialogueAsync',
    dialogueLineId: data.dialogueLineId,
  };

  // 1. Fetch dialogue line with episode and account context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: dialogueLine, error: fetchError } = await (client as any)
    .from('dialogue_lines')
    .select(
      `
      id,
      episode_id,
      text,
      character_asset_id,
      audio_url,
      status,
      episodes!inner(
        id,
        project_id,
        projects!inner(
          id,
          account_id
        )
      )
    `,
    )
    .eq('id', data.dialogueLineId)
    .single();

  if (readFailed(fetchError)) {
    throw new Error(whyNoRow(fetchError, 'Dialogue line not found'));
  }

  if (fetchError || !dialogueLine) {
    return {
      success: false,
      status: 'failed',
      error: 'Dialogue line not found',
    };
  }

  const dialogueData = dialogueLine as DialogueLineResponse;
  const episodeId = dialogueData.episode_id;

  // The voice worker spends the target account's key and writes the line
  // with the service role, so a reader must not queue it (KB-46, KB-47)
  const target = await authorizeEpisodeTarget(client, episodeId);

  if (!target?.projectId) {
    logger.warn(
      { ...ctx, userId: userId, reason: 'not_writable' },
      'Voice generation refused',
    );
    return {
      success: false,
      status: 'failed',
      error: 'Dialogue line not found',
    };
  }

  const projectId = target.projectId;

  // Validate text is not empty
  const dialogueText = dialogueData.text?.trim();
  if (!dialogueText) {
    return {
      success: false,
      status: 'failed',
      error: 'Dialogue text is empty',
    };
  }

  // 2. Get voice ID from params or character's voice profile
  const voiceId =
    data.voiceId ??
    (await getVoiceIdForCharacter(client, dialogueData.character_asset_id));

  if (!voiceId) {
    return {
      success: false,
      status: 'failed',
      error:
        'No voice ID provided and character has no voice profile configured',
    };
  }

  // 3. Get voice settings from profile or use defaults
  const voiceSettings =
    data.settings ??
    (await getVoiceSettings(client, dialogueData.character_asset_id));

  // 4. Get TTS model for project
  const ttsModel = await getProjectTTSModel(projectId, client);

  try {
    // 5. Update status to 'generating' (queued for background)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: generating, error: generatingError } = await (client as any)
      .from('dialogue_lines')
      .update({ status: 'generating' })
      .eq('id', data.dialogueLineId)
      .select('id');

    if (generatingError) {
      throw new Error(
        `Failed to update dialogue_lines: ${generatingError.message}`,
      );
    }

    requireAffectedRows(
      generating,
      "You can't generate audio for this dialogue line.",
    );

    // 6. Enqueue voice job for background processing via dedicated voice queue
    const { queueVoiceJob } = await import(
      '@kit/audio-generation/server/voice-queue-helper'
    );

    await queueVoiceJob(target, {
      dialogueLineId: data.dialogueLineId,
      batchJobId: null, // single-line generation, no batch tracking
      episodeId,
      voiceId,
      ttsModel,
      voiceSettings: {
        stability: voiceSettings.stability ?? 0.5,
        similarityBoost: voiceSettings.similarityBoost ?? 0.75,
        style: voiceSettings.style,
        speed: voiceSettings.speed,
      },
      text: dialogueText,
      characterAssetId: dialogueData.character_asset_id ?? undefined,
      userId: userId,
      overwriteExisting: data.overwriteExisting ?? false,
    });

    logger.info(ctx, 'Dialogue voice generation job queued successfully');

    return { success: true, status: 'queued' };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    logger.error(
      { ...ctx, error },
      'Failed to queue dialogue voice generation',
    );

    // Revert status to pending
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('dialogue_lines')
      .update({ status: 'pending' })
      .eq('id', data.dialogueLineId);

    return { success: false, status: 'failed', error: errorMsg };
  }
}

/**
 * Voice for every line of an episode that has none (or every line, with
 * `overwriteExisting`): one batch_generation_jobs row with the estimated
 * cost, then one queue message per line. Refusals throw ActionRefusal.
 */
export async function startEpisodeVoiceRender(
  client: Client,
  userId: string,
  data: BatchGenerateDialogueSchemaType,
): Promise<BatchGenerateDialogueResult> {
  const overwriteExisting = data.overwriteExisting ?? false;
  const logger = await getLogger();
  const ctx = {
    name: 'batch.generateDialogue',
    episodeId: data.episodeId,
    overwriteExisting,
  };

  // 1. The episode, as one the caller can write to. The voice worker spends
  // its account's key and writes its lines with the service role, so a
  // reader — a project viewer, or anyone on a public project — must not
  // queue it (KB-47)
  const target = await authorizeEpisodeTarget(client, data.episodeId);

  if (!target?.projectId) {
    logger.warn(
      { ...ctx, userId: userId, reason: 'not_writable' },
      'Batch voice generation refused',
    );
    throw new ActionRefusal('Episode not found');
  }

  const { accountId, projectId } = target;

  // 2. Fetch dialogue lines for episode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: dialogueLines, error: linesError } = await (client as any)
    .from('dialogue_lines')
    .select(
      'id, episode_id, character_asset_id, text, audio_url, status, sequence_number',
    )
    .eq('episode_id', data.episodeId)
    .order('sequence_number', { ascending: true });

  if (linesError) {
    logger.error({ ...ctx, error: linesError }, 'Failed to fetch dialogue');
    throw new Error('Failed to fetch dialogue lines');
  }

  const allLines = (dialogueLines ?? []) as DialogueLineForBatch[];

  // 3. Filter lines to process
  const linesToProcess = allLines.filter((line) => {
    if (overwriteExisting) return true;
    return !line.audio_url || line.status === 'failed';
  });

  if (linesToProcess.length === 0) {
    throw new ActionRefusal(
      'No dialogue lines to process. All lines already have audio.',
    );
  }

  logger.info(
    { ...ctx, totalLines: allLines.length, toProcess: linesToProcess.length },
    'Filtered dialogue lines',
  );

  // 4. Build voice assignments
  const voiceAssignments = await buildVoiceAssignments(
    client,
    linesToProcess,
    data.voiceAssignments,
  );

  // Validate all characters have voice assignments
  const linesWithCharacter = linesToProcess.filter(
    (line) => line.character_asset_id,
  );
  const missingVoices = linesWithCharacter.filter(
    (line) => !voiceAssignments[line.character_asset_id!],
  );

  if (missingVoices.length > 0) {
    const missingCharacterIds = [
      ...new Set(missingVoices.map((l) => l.character_asset_id)),
    ];
    logger.warn(
      { ...ctx, missingCharacterIds },
      'Missing voice assignments for characters',
    );
    throw new ActionRefusal(
      `Missing voice assignments for ${missingCharacterIds.length} character(s). ` +
        `Please assign voices or create voice profiles.`,
    );
  }

  // 5. Estimate total cost
  const estimatedCost = linesToProcess.reduce((total, line) => {
    return total + estimateVoiceCost(line.text.length);
  }, 0);

  // 7. Get TTS model for the project
  const ttsModel = await getProjectTTSModel(projectId, client);

  // 8. Create batch job
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: batchJob, error: jobError } = await (client as any)
    .from('batch_generation_jobs')
    .insert({
      episode_id: data.episodeId,
      account_id: accountId,
      status: 'processing',
      total_lines: linesToProcess.length,
      completed_lines: 0,
      failed_lines: 0,
      estimated_cost: estimatedCost,
      actual_cost: 0,
      voice_assignments: voiceAssignments,
      errors: [],
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (jobError || !batchJob) {
    logger.error({ ...ctx, error: jobError }, 'Failed to create batch job');
    throw new Error('Failed to create batch job');
  }

  const job = batchJob as { id: string };

  logger.info(
    { ...ctx, batchJobId: job.id, estimatedCost },
    'Batch job created, dispatching to voice queue',
  );

  // 9. Dispatch all lines to the voice SQS queue
  const voiceJobs = linesToProcess.map((line) => {
    const assignment = line.character_asset_id
      ? voiceAssignments[line.character_asset_id]
      : null;

    return {
      dialogueLineId: line.id,
      batchJobId: job.id,
      episodeId: data.episodeId,
      voiceId: assignment?.voiceId ?? '',
      ttsModel,
      voiceSettings: {
        stability: assignment?.settings?.stability ?? 0.5,
        similarityBoost: assignment?.settings?.similarityBoost ?? 0.75,
        style: assignment?.settings?.style,
        speed: assignment?.settings?.speed,
      },
      text: line.text,
      characterAssetId: line.character_asset_id ?? undefined,
      userId: userId,
      overwriteExisting: true,
    };
  });

  await queueVoiceJobs(target, voiceJobs);

  logger.info(
    { ...ctx, batchJobId: job.id, queuedCount: voiceJobs.length },
    'All dialogue lines dispatched to voice queue',
  );

  // 10. Return batch job info immediately
  const estimatedDuration = Math.ceil(linesToProcess.length / 5) * 10;

  return {
    batchJobId: job.id,
    episodeId: data.episodeId,
    totalLines: linesToProcess.length,
    estimatedCost,
    estimatedDuration,
    status: 'queued',
  };
}

/**
 * Music, SFX or ambience for one audio cue: the cue is marked generating,
 * then the `audio-file-generation` job is queued for the LLM worker, which
 * renders it with the account's ElevenLabs key (no model call).
 */
export async function startCueAudioRender(
  client: Client,
  userId: string,
  cueId: string,
): Promise<RenderStart> {
  // Get cue details
  const { data: cue, error: cueError } = await client
    .from('audio_cues')
    .select(
      `
              id, episode_id, scene_number, cue_type, prompt,
              start_offset_seconds, duration_seconds, is_loopable, status,
              audio_asset_id, audio_track_id, created_at,
              episodes!inner(project_id)
          `,
    )
    .eq('id', cueId)
    .single();

  if (readFailed(cueError)) {
    throw new Error(whyNoRow(cueError, 'Cue not found'));
  }

  if (cueError || !cue) {
    return {
      success: false,
      status: 'failed',
      error: cueError?.message ?? 'Cue not found',
    };
  }

  // The worker spends the project's ElevenLabs key and writes the cue on
  // the service-role key, so the caller must be able to write to the
  // cue's project (KB-31) — before the cue is marked generating
  const target = await authorizeEpisodeTarget(client, cue.episode_id);

  if (!target?.projectId) {
    return {
      success: false,
      status: 'failed',
      error: 'Cue not found',
    };
  }

  const { projectId } = target;

  // The worker generates only these; any other type would be refused
  // there, after the cue was marked generating (KB-33)
  const cueType = AudioCueTypeSchema.safeParse(cue.cue_type);

  if (!cueType.success) {
    return {
      success: false,
      status: 'failed',
      error: `Cannot generate audio for a ${cue.cue_type} cue`,
    };
  }

  try {
    // 1. Update cue status to 'generating'
    const { data: generating, error: generatingError } = await client
      .from('audio_cues')
      .update({ status: 'generating' })
      .eq('id', cueId)
      .select('id');

    if (generatingError) {
      throw new Error(
        `Failed to update audio_cues: ${generatingError.message}`,
      );
    }

    requireAffectedRows(generating, "You can't generate audio for this cue.");

    // 2. Enqueue LLM job for background processing
    const { openRunForJob } = await import('@kit/ai-gateway');

    const run = await openRunForJob(
      {
        jobType: 'audio-file-generation',
        userId,
        target,
        payload: {
          cueId,
          projectId,
          episodeId: cue.episode_id,
          cueType: cueType.data,
          prompt: cue.prompt,
          durationSeconds: cue.duration_seconds ?? 60,
          startOffsetSeconds: cue.start_offset_seconds ?? 0,
        },
        name: 'audio.generateAudioFile',
      },
      { client: client, accountId: target.accountId, userId },
    );
    await run.dispatch();

    // 3. Return immediately - result comes via WebSocket
    return { success: true, status: 'queued' };
  } catch (error) {
    // Revert status on enqueue failure
    await client
      .from('audio_cues')
      .update({ status: 'pending' })
      .eq('id', cueId);

    // Server generation turned off, or the stage already held (KB-182)
    const { runRefusalMessage } = await import('@kit/ai-gateway');

    return {
      success: false,
      status: 'failed',
      error:
        runRefusalMessage(error) ??
        (error instanceof Error ? error.message : 'Failed to queue generation'),
    };
  }
}
