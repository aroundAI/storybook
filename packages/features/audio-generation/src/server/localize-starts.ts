import 'server-only';

/**
 * Starting an episode's localization (FILM-2007): for each language, a
 * `dub-episode` job on the voice queue that voices the episode's dialogue,
 * translated, with each speaker's voice. Called with the caller's client
 * (the principal's RLS client over MCP), so the same checks as
 * start_voice_render run: the episode must be writable
 * (`authorizeEpisodeTarget`, KB-31, KB-46, KB-47), every speaking character
 * needs a voice, the project needs a TTS model, and the worker renders on
 * the team's own ElevenLabs key. Translation is the `translate-dialogue`
 * job on the generation core, opened through the gateway, so the LLM spend
 * cap, server mode and model availability are checked here, before
 * anything is written, and its cost is recorded as every LLM job's is.
 *
 * One translation run per episode can be open at a time (the run lock), so
 * every language still to translate goes into one run, which translates
 * them in turn; the dub job of each waits for its own language.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { ActionRefusal } from '@kit/next/action-result';
import {
  type LlmJobTarget,
  authorizeEpisodeTarget,
} from '@kit/prompt-engine/llm-job-target';
import { fetchAllRows } from '@kit/shared/pagination';
import type { Database, Json } from '@kit/supabase/database';

import {
  DUB_IN_FLIGHT_STATUSES,
  DUB_STALE_MS,
  DUB_WAIT_SECONDS,
  type DubEpisodeMessageInput,
  type LocalizeLanguage,
  SOURCE_DIALOGUE_LANGUAGE,
  dubTtsModel,
} from '../lib/dub-episode';
import { estimateVoiceCost } from '../lib/voice-utils';
import { getProjectTTSModel } from './project-audio-settings';
import {
  type DialogueLineForBatch,
  buildVoiceAssignments,
} from './render-starts';

type Client = SupabaseClient<Database>;

/** A refusal because the work is already under way: RUN_IN_PROGRESS over MCP. */
export class LocalizationInProgress extends Error {
  override readonly name = 'LocalizationInProgress';
}

export interface LocalizeDeps {
  /** Opens and dispatches the translate-dialogue run; returns its id */
  openTranslationRun: (
    client: Client,
    userId: string,
    target: LlmJobTarget,
    languages: LocalizeLanguage[],
  ) => Promise<string>;
  queueDubJobs: (
    target: LlmJobTarget,
    jobs: Array<{ message: DubEpisodeMessageInput; delaySeconds: number }>,
  ) => Promise<void>;
  now?: () => Date;
}

export const webLocalizeDeps: LocalizeDeps = {
  async openTranslationRun(client, userId, target, languages) {
    const { openRunForJob, runRefusalMessage, STAGE_IN_PROGRESS_REFUSAL } =
      await import('@kit/ai-gateway');
    const [first, ...rest] = languages;

    try {
      const run = await openRunForJob(
        {
          jobType: 'translate-dialogue',
          userId,
          target,
          payload: {
            episodeId: target.episodeId!,
            targetLanguage: first!,
            additionalLanguages: rest,
            preserveTiming: true,
            accountId: target.accountId,
            userId,
          },
          name: 'audio.localizeEpisode',
        },
        { client, accountId: target.accountId, userId },
      );
      await run.dispatch();

      return run.id;
    } catch (error) {
      const refusal = runRefusalMessage(error);

      if (refusal === STAGE_IN_PROGRESS_REFUSAL) {
        throw new LocalizationInProgress(
          "This episode's dialogue is already being translated. Try again when that finishes.",
        );
      }

      if (refusal) throw new ActionRefusal(refusal);

      throw error;
    }
  },
  async queueDubJobs(target, jobs) {
    const { queueDubEpisodeJobs } = await import('./voice-queue-helper');

    await queueDubEpisodeJobs(target, jobs);
  },
};

export interface LocalizeInput {
  episodeId: string;
  languages: LocalizeLanguage[];
  /** Who asked: the MCP client's name, for the record */
  requestedBy?: string;
}

export interface LocalizationJob {
  language: LocalizeLanguage;
  dubbedVersionId: string;
  status: 'translating' | 'voicing';
  /** Lines to voice: one per source line */
  lines: number;
  estimatedCost: number;
}

export interface LocalizationStart {
  episodeId: string;
  translationRunId: string | null;
  jobs: LocalizationJob[];
}

type SourceLine = DialogueLineForBatch & {
  language: string;
  source_dialogue_id: string | null;
};

const LINE_COLUMNS =
  'id, episode_id, character_asset_id, text, audio_url, status, sequence_number, language, source_dialogue_id';

/**
 * Queues a dub of the episode per language. Refusals throw `ActionRefusal`
 * (worded for the user) or `LocalizationInProgress`; nothing is written
 * before every check has passed.
 */
export async function startEpisodeLocalization(
  client: Client,
  userId: string,
  input: LocalizeInput,
  deps: LocalizeDeps = webLocalizeDeps,
): Promise<LocalizationStart> {
  const now = (deps.now ?? (() => new Date()))();
  const target = await authorizeEpisodeTarget(client, input.episodeId);

  if (!target?.projectId) throw new ActionRefusal('Episode not found');

  const lines = await fetchAllRows<SourceLine>(
    (from, to) =>
      client
        .from('dialogue_lines')
        .select(LINE_COLUMNS)
        .eq('episode_id', input.episodeId)
        .in('language', [SOURCE_DIALOGUE_LANGUAGE, ...input.languages])
        .order('id')
        .range(from, to) as unknown as PromiseLike<{
        data: SourceLine[] | null;
        error: { message: string } | null;
      }>,
    'dialogue_lines',
  );

  const source = lines
    .filter((line) => line.language === SOURCE_DIALOGUE_LANGUAGE)
    .filter((line) => line.text?.trim())
    .sort((a, b) => a.sequence_number - b.sequence_number);

  if (source.length === 0) {
    throw new ActionRefusal(
      'The episode has no English dialogue to localize. Generate the screenplay first.',
    );
  }

  const voiceAssignments = await buildVoiceAssignments(client, source);
  const unvoiced = [
    ...new Set(
      source
        .map((line) => line.character_asset_id)
        .filter((id): id is string => !!id && !voiceAssignments[id]),
    ),
  ];

  if (unvoiced.length > 0) {
    throw new ActionRefusal(
      `Missing voice assignments for ${unvoiced.length} character(s). ` +
        `Please assign voices or create voice profiles.`,
    );
  }

  const ttsModel = dubTtsModel(
    await getProjectTTSModel(target.projectId, client),
  );

  // A dub already being made is not started twice; one stuck for an hour is
  // taken as dead and may be started again
  const { data: existing, error: existingError } = await client
    .from('dubbed_versions')
    .select('id, language, status, updated_at')
    .eq('episode_id', input.episodeId)
    .in('language', input.languages);

  if (existingError) {
    throw new Error(
      `Could not read the dubbed versions: ${existingError.message}`,
    );
  }

  const busy = (existing ?? []).filter(
    (row) =>
      DUB_IN_FLIGHT_STATUSES.has(row.status) &&
      now.getTime() - new Date(row.updated_at).getTime() < DUB_STALE_MS,
  );

  if (busy.length > 0) {
    throw new LocalizationInProgress(
      `Already localizing into ${busy.map((row) => row.language).join(', ')}. Poll get_render_progress; try again when it finishes.`,
    );
  }

  const sourceIds = new Set(source.map((line) => line.id));
  const translated = (language: string) =>
    new Set(
      lines
        .filter(
          (line) =>
            line.language === language &&
            line.source_dialogue_id &&
            sourceIds.has(line.source_dialogue_id),
        )
        .map((line) => line.source_dialogue_id),
    ).size;
  const untranslated = input.languages.filter(
    (language) => translated(language) < source.length,
  );

  // The gateway's checks (spend cap, server mode, model) refuse here
  const translationRunId =
    untranslated.length > 0
      ? await deps.openTranslationRun(client, userId, target, untranslated)
      : null;

  const characters = source.reduce((sum, line) => sum + line.text.length, 0);
  const estimatedCost = source.reduce(
    (sum, line) => sum + estimateVoiceCost(line.text.length),
    0,
  );
  const sourceRecord = {
    kind: 'dialogue_lines' as const,
    lines: source.length,
    withAudio: source.filter((line) => line.audio_url).length,
  };

  const { data: versions, error: upsertError } = await client
    .from('dubbed_versions')
    .upsert(
      input.languages.map((language) => {
        const waiting = untranslated.includes(language);

        return {
          episode_id: input.episodeId,
          language,
          status: waiting ? 'translating' : 'voicing',
          translation_status: waiting ? 'processing' : 'completed',
          voice_status: 'pending',
          sync_status: 'pending',
          metadata: {
            localization: {
              method: 'per_line_tts',
              requestedAt: now.toISOString(),
              requestedBy: userId,
              client: input.requestedBy ?? null,
              translationRunId: waiting ? translationRunId : null,
              ttsModel,
              source: sourceRecord,
              lines: source.length,
              characters,
              estimatedCost,
            },
          } as Json,
        };
      }),
      { onConflict: 'episode_id,language' },
    )
    .select('id, language');

  if (upsertError || !versions || versions.length !== input.languages.length) {
    throw new Error(
      `Could not record the dubbed versions: ${upsertError?.message ?? 'no rows returned'}`,
    );
  }

  const idOf = new Map(versions.map((row) => [row.language, row.id]));
  const jobs: LocalizationJob[] = input.languages.map((language) => ({
    language,
    dubbedVersionId: idOf.get(language)!,
    status: untranslated.includes(language) ? 'translating' : 'voicing',
    lines: source.length,
    estimatedCost,
  }));

  await deps.queueDubJobs(
    target,
    jobs.map((job) => ({
      delaySeconds: job.status === 'translating' ? DUB_WAIT_SECONDS : 0,
      message: {
        kind: 'dub-episode',
        dubbedVersionId: job.dubbedVersionId,
        episodeId: input.episodeId,
        accountId: target.accountId,
        userId,
        language: job.language,
        ttsModel,
        voiceAssignments,
        translationRunId:
          job.status === 'translating' ? translationRunId : null,
        source: sourceRecord,
        requestedAt: now.toISOString(),
        waits: 0,
      },
    })),
  );

  return { episodeId: input.episodeId, translationRunId, jobs };
}
