import 'server-only';

import { z } from 'zod';

import {
  type RenderStart,
  startCueAudioRender,
  startDialogueVoiceRender,
  startEpisodeVoiceRender,
} from '@kit/audio-generation/server/render-starts';

import { McpToolError } from '../../../errors';
import { type McpToolContext, defineTool } from '../../../registry';
import { requireEpisodeInAccount } from '../read/scope';
import { refused } from '../validation';

type Client = McpToolContext['principal']['supabase'];

/**
 * The web's own render starts (FILM-1909): the tools call these with the
 * principal's RLS client, so the write check, voice assignment and the
 * account's ElevenLabs key apply exactly as they do on the web. Injected
 * so a test can stand in for the queue.
 */
export interface RenderStartDeps {
  startDialogueVoiceRender: typeof startDialogueVoiceRender;
  startEpisodeVoiceRender: typeof startEpisodeVoiceRender;
  startCueAudioRender: typeof startCueAudioRender;
}

export const webRenderStarts: RenderStartDeps = {
  startDialogueVoiceRender,
  startEpisodeVoiceRender,
  startCueAudioRender,
};

/** A vendor render costs money: never read-only, never idempotent. */
const RENDER = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
} as const;

/** What the web shows as a refusal; anything else the core returned is a fault. */
const REFUSALS = new Set([
  'Authentication required',
  'Dialogue text is empty',
  'No voice ID provided and character has no voice profile configured',
]);

const NOT_FOUND = new Set(['Dialogue line not found', 'Cue not found']);

/** The value a core returned, as a tool result or a contract error. */
function startResult(start: RenderStart, what: string, id: string) {
  if (start.success) return;

  const message = start.error ?? 'The render could not be started.';

  if (NOT_FOUND.has(message)) {
    throw new McpToolError('NOT_FOUND', message, { details: { id } });
  }

  if (REFUSALS.has(message) || message.startsWith('Cannot generate audio')) {
    throw refused(message);
  }

  throw new McpToolError(
    'INTERNAL',
    `The ${what} could not be queued. Try again; if it keeps failing, report the request id.`,
    { details: { id } },
  );
}

/**
 * A core's thrown refusal (ActionRefusal, worded for the user) or a
 * missing project setting, as the contract's codes; anything else stays a
 * fault for `toMcpToolError`.
 */
function asContractError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;

  if (error.name === 'ActionRefusal') {
    return error.message === 'Episode not found'
      ? new McpToolError('NOT_FOUND', error.message)
      : refused(error.message);
  }

  if (error.message.startsWith('No TTS model configured')) {
    return refused(error.message, 'projectSettings.audio.ttsModel');
  }

  return error;
}

async function requireRowOfEpisode(
  client: Client,
  table: 'dialogue_lines' | 'audio_cues',
  id: string,
  episodeId: string,
) {
  const { data, error } = await client
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('episode_id', episodeId)
    .maybeSingle();

  if (error) {
    throw new McpToolError('INTERNAL', `Could not read the ${table}.`);
  }

  if (!data) {
    throw new McpToolError(
      'NOT_FOUND',
      table === 'dialogue_lines'
        ? 'No dialogue line with this id in the episode.'
        : 'No audio cue with this id in the episode.',
      { details: { id, episodeId } },
    );
  }
}

const voiceAssignmentArg = z.object({
  voiceId: z.string().min(1).describe('An ElevenLabs voice id.'),
});

export function createRenderStartTools(deps: RenderStartDeps) {
  const startVoiceRenderTool = defineTool({
    name: 'start_voice_render',
    title: 'Start voice render',
    description:
      "Queues ElevenLabs voice for an episode's dialogue, as the audio studio's Generate buttons do: one line (dialogueLineId) or every line that has no audio yet (omit it; overwriteExisting re-renders every line). Speakers need a voice: the character's profile voice, or voiceAssignments by character asset id. Renders bill the team's own ElevenLabs key and run in the background; poll get_render_progress. No language model is called.",
    inputSchema: {
      episodeId: z.string().uuid().describe('The episode id.'),
      dialogueLineId: z
        .string()
        .uuid()
        .optional()
        .describe('One line (from get_dialogue); omit for the whole episode.'),
      voiceId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "With dialogueLineId: this voice instead of the speaker's profile voice.",
        ),
      voiceAssignments: z
        .record(z.string().uuid(), voiceAssignmentArg)
        .optional()
        .describe(
          'Without dialogueLineId: a voice per character asset id, over the profile voices.',
        ),
      overwriteExisting: z
        .boolean()
        .optional()
        .describe('Re-render lines that already have audio. Default false.'),
    },
    scope: 'studio:render',
    annotations: RENDER,
    async handler(input, context) {
      const client = context.principal.supabase;
      const userId = context.principal.userId;

      await requireEpisodeInAccount(
        client,
        context.accountId,
        input.episodeId,
        'id',
      );

      if (input.dialogueLineId) {
        if (input.voiceAssignments) {
          throw refused(
            'voiceAssignments is for the whole episode; pass voiceId with a single line.',
            'voiceAssignments',
          );
        }

        await requireRowOfEpisode(
          client,
          'dialogue_lines',
          input.dialogueLineId,
          input.episodeId,
        );

        const start = await deps
          .startDialogueVoiceRender(client, userId, {
            dialogueLineId: input.dialogueLineId,
            voiceId: input.voiceId,
            overwriteExisting: input.overwriteExisting,
          })
          .catch((error: unknown) => {
            throw asContractError(error);
          });

        startResult(start, 'voice render', input.dialogueLineId);

        return {
          text: `Voice render queued for line ${input.dialogueLineId}. Poll get_render_progress for the result.`,
          structuredContent: {
            status: 'queued',
            scope: 'line',
            episodeId: input.episodeId,
            dialogueLineId: input.dialogueLineId,
          },
        };
      }

      if (input.voiceId) {
        throw refused(
          'voiceId is for a single line; pass voiceAssignments for the whole episode.',
          'voiceId',
        );
      }

      const batch = await deps
        .startEpisodeVoiceRender(client, userId, {
          episodeId: input.episodeId,
          voiceAssignments: input.voiceAssignments,
          overwriteExisting: input.overwriteExisting,
        })
        .catch((error: unknown) => {
          throw asContractError(error);
        });

      return {
        text: `Voice render queued for ${batch.totalLines} lines (batch ${batch.batchJobId}, estimated cost ${batch.estimatedCost}). Poll get_render_progress with the batch id.`,
        structuredContent: {
          status: 'queued',
          scope: 'episode',
          episodeId: input.episodeId,
          batchJobId: batch.batchJobId,
          totalLines: batch.totalLines,
          estimatedCost: batch.estimatedCost,
          estimatedDurationSeconds: batch.estimatedDuration,
        },
      };
    },
  });

  const startAudioRenderTool = defineTool({
    name: 'start_audio_render',
    title: 'Start music or SFX render',
    description:
      "Queues the audio for one audio cue (music, SFX or ambience) from its stored prompt, as the audio studio's Generate button on a cue does. The cue must belong to the episode. Renders bill the team's own ElevenLabs key and run in the background; poll get_render_progress. No language model is called.",
    inputSchema: {
      episodeId: z.string().uuid().describe('The episode id.'),
      cueId: z.string().uuid().describe('The audio cue id.'),
    },
    scope: 'studio:render',
    annotations: RENDER,
    async handler(input, context) {
      const client = context.principal.supabase;

      await requireEpisodeInAccount(
        client,
        context.accountId,
        input.episodeId,
        'id',
      );
      await requireRowOfEpisode(
        client,
        'audio_cues',
        input.cueId,
        input.episodeId,
      );

      const start = await deps
        .startCueAudioRender(client, context.principal.userId, input.cueId)
        .catch((error: unknown) => {
          throw asContractError(error);
        });

      startResult(start, 'audio render', input.cueId);

      return {
        text: `Audio render queued for cue ${input.cueId}. Poll get_render_progress for the result.`,
        structuredContent: {
          status: 'queued',
          episodeId: input.episodeId,
          cueId: input.cueId,
        },
      };
    },
  });

  return { startVoiceRenderTool, startAudioRenderTool };
}
