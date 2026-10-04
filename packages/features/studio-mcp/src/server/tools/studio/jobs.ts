import 'server-only';

import { z } from 'zod';

import {
  LOCALIZE_LANGUAGES,
  LocalizeLanguagesSchema,
} from '@kit/audio-generation/dub-episode';
import {
  type LocalizationStart,
  type LocalizeDeps,
  type LocalizeInput,
  startEpisodeLocalization,
} from '@kit/audio-generation/server/localize-starts';
import { SHOT_REGENERATION_MAX } from '@kit/generation';
import { authorizeEpisodeTarget } from '@kit/prompt-engine/llm-job-target';
import type { Json } from '@kit/supabase/database';

import { McpToolError } from '../../../errors';
import { type McpToolContext, defineTool } from '../../../registry';
import {
  GenerationService,
  type GenerationToolDeps,
  generationToolDeps,
} from '../generation';
import { requireEpisodeInAccount } from '../read/scope';
import { parseWith, refused } from '../validation';

type Client = McpToolContext['principal']['supabase'];

/**
 * FILM-2007: the two things the Studio asks StoryBook to do because only
 * StoryBook can. Neither renders video.
 *
 * - regenerate_shots re-plans some shots (lead decision 6): a shots run
 *   scoped to them, opened in the request's mode (external over MCP: the
 *   agent writes the new plan through get_brief / submit_generation /
 *   finalize_generation). The shots go to `queued` with their video
 *   cleared at once, so the Studio's package etag changes and its re-sync
 *   sees them; finalize writes the new plan and moves episodes.version.
 * - localize_episode voices the episode in other languages by per-line TTS
 *   (README Q6, lead default), one `dub-episode` job per language on the
 *   voice queue.
 *
 * Both are `studio:render`: they spend (a model or the team's ElevenLabs
 * key) and both need write access to the project (member or above).
 */
export interface StudioJobDeps {
  generation: () => GenerationToolDeps;
  localize: (
    client: Client,
    userId: string,
    input: LocalizeInput,
  ) => Promise<LocalizationStart>;
}

/** Clears the shots' video (kept in their metadata) and writes no vendor. */
const REPLAN = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** Spends a model and the team's ElevenLabs key; adds, never removes. */
const LOCALIZE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

/** Refused unless the caller may write the episode's project (member or above). */
async function requireWritableEpisode(
  client: Client,
  accountId: string,
  episodeId: string,
) {
  await requireEpisodeInAccount(client, accountId, episodeId, 'id');

  const target = await authorizeEpisodeTarget(client, episodeId);

  if (!target?.projectId) {
    throw new McpToolError(
      'FORBIDDEN',
      'You can read this episode but not change it: this needs the member role (or above) on its project.',
      { details: { episodeId } },
    );
  }

  return target;
}

interface QueuedShot {
  id: string;
  status: string;
  video_url: string | null;
  generation_metadata: Json | null;
}

function metadataOf(value: Json | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function createStudioJobTools(deps: StudioJobDeps) {
  const regenerateShotsTool = defineTool({
    name: 'regenerate_shots',
    title: 'Regenerate shots',
    description: `Re-plans up to ${SHOT_REGENERATION_MAX} shots of an episode (prompt, frames, camera, length) for a reason, e.g. "shot 7 reads as daytime". Opens a shots run scoped to those shots and returns its runId with the first brief: write each shot with submit_generation (part shot:<id>, one shot object, kind 'shot'), then finalize_generation. The shots go to status queued with their video cleared now (the old URL is kept in their generation_metadata.regeneration), so get_edit_package's etag changes; finalize writes the new plan and bumps the episode version. No video is rendered: the new plan is filled by the usual upload path or your own video tool (get_veo_manifest). A shot that is generating is refused with RUN_IN_PROGRESS.`,
    inputSchema: {
      episodeId: z.string().uuid().describe('The episode id.'),
      shotIds: z
        .array(z.string().uuid())
        .min(1)
        .describe(
          `The shots to re-plan (ids from get_edit_package or list_shots), at most ${SHOT_REGENERATION_MAX}.`,
        ),
      reason: z
        .string()
        .min(1)
        .max(500)
        .describe('Why: what is wrong with these shots now.'),
    },
    scope: 'studio:render',
    annotations: REPLAN,
    async handler(input, context) {
      const ids = input.shotIds;

      if (ids.length > SHOT_REGENERATION_MAX) {
        throw refused(
          `At most ${SHOT_REGENERATION_MAX} shots per call; ${ids.length} were listed. Split them across calls.`,
          'shotIds',
        );
      }

      if (new Set(ids).size !== ids.length) {
        throw refused('A shot is listed twice.', 'shotIds');
      }

      if (!input.reason.trim()) {
        throw refused('Say why the shots are being re-planned.', 'reason');
      }

      const client = context.principal.supabase;

      await requireWritableEpisode(client, context.accountId, input.episodeId);

      const { data, error } = await client
        .from('shots')
        .select('id, status, video_url, generation_metadata')
        .eq('episode_id', input.episodeId)
        .is('deleted_at', null)
        .in('id', ids);

      if (error) {
        throw new McpToolError('INTERNAL', 'Could not read the shots.');
      }

      const shots = (data ?? []) as QueuedShot[];
      const found = new Set(shots.map((shot) => shot.id));
      const missing = ids.filter((id) => !found.has(id));

      if (missing.length > 0) {
        throw new McpToolError(
          'NOT_FOUND',
          `No shot ${missing.join(', ')} in this episode (deleted shots are not visible).`,
          { details: { episodeId: input.episodeId, shotIds: missing } },
        );
      }

      const generating = shots.filter((shot) => shot.status === 'generating');

      if (generating.length > 0) {
        throw new McpToolError(
          'RUN_IN_PROGRESS',
          `Shot(s) ${generating.map((shot) => shot.id).join(', ')} are generating video now; re-plan them once that finishes.`,
          { details: { shotIds: generating.map((shot) => shot.id) } },
        );
      }

      const service = new GenerationService(deps.generation(), context);
      const started = await service.startAs(
        {
          stage: 'shots',
          episodeId: input.episodeId,
          options: {
            regenerate: { shotIds: ids, reason: input.reason.trim() },
          },
        },
        'regenerate_shots',
      );
      const runId = started.run.runId;
      const requestedAt = new Date().toISOString();

      // Queued and cleared as the caller (RLS), after the run holds the
      // shots: a stage commit may not write status or media (FILM-1909)
      try {
        for (const shot of shots) {
          const metadata = metadataOf(shot.generation_metadata);
          const { data: queued, error: queueError } = await client
            .from('shots')
            .update({
              status: 'queued',
              video_url: null,
              thumbnail_url: null,
              generation_metadata: {
                ...metadata,
                regeneration: {
                  reason: input.reason.trim(),
                  runId,
                  requestedAt,
                  requestedBy: context.principal.userId,
                  client: context.principal.clientName,
                  previousStatus: shot.status,
                  previousVideoUrl: shot.video_url,
                },
              } as Json,
            })
            .eq('id', shot.id)
            .eq('episode_id', input.episodeId)
            .neq('status', 'generating')
            .select('id');

          if (queueError || !queued?.length) {
            throw new Error(queueError?.message ?? `shot ${shot.id} changed`);
          }
        }
      } catch {
        await service.cancel(runId).catch(() => undefined);

        throw new McpToolError(
          'INTERNAL',
          'Could not queue the shots; the run was cancelled. Try again.',
          { details: { runId } },
        );
      }

      return {
        text: `Run ${runId} re-plans ${ids.length} shot(s) of episode ${input.episodeId}; they are queued with their video cleared. Write each part (${started.run.parts?.map((p) => p.partKey).join(', ')}) with submit_generation, then finalize_generation.`,
        structuredContent: {
          runId,
          mode: started.run.mode,
          episodeId: input.episodeId,
          shots: shots.map((shot) => ({
            shotId: shot.id,
            status: 'queued',
            previousStatus: shot.status,
          })),
          run: started.run,
          brief: started.brief,
        },
      };
    },
  });

  const localizeEpisodeTool = defineTool({
    name: 'localize_episode',
    title: 'Localize episode',
    description: `Voices an episode's dialogue in other languages: per language, the dialogue is translated (StoryBook's dialogue translation, billed as LLM usage) and each line is spoken with its speaker's ElevenLabs voice on the team's own key, placed at the source line's start. Languages: ${LOCALIZE_LANGUAGES.join(', ')} (BCP-47 primary subtags; English is the source). Returns a job per language (its dubbedVersionId); poll get_render_progress. When a language is ready the episode version moves, and get_edit_package's dubbed block lists its lines with audio. Every speaking character needs a voice, as for start_voice_render.`,
    inputSchema: {
      episodeId: z.string().uuid().describe('The episode id.'),
      languages: z
        .array(z.string())
        .min(1)
        .describe(`Target languages, e.g. ["hi", "es"].`),
    },
    scope: 'studio:render',
    annotations: LOCALIZE,
    async handler(input, context) {
      const languages = parseWith(LocalizeLanguagesSchema, input.languages);
      const client = context.principal.supabase;

      await requireWritableEpisode(client, context.accountId, input.episodeId);

      let started: LocalizationStart;

      try {
        started = await deps.localize(client, context.principal.userId, {
          episodeId: input.episodeId,
          languages,
          requestedBy: context.principal.clientName,
        });
      } catch (error) {
        throw asContractError(error);
      }

      return {
        text: `Localizing episode ${input.episodeId} into ${started.jobs.map((job) => `${job.language} (${job.status})`).join(', ')}${started.translationRunId ? `; translation run ${started.translationRunId}` : ''}. Poll get_render_progress.`,
        structuredContent: started as unknown as Record<string, unknown>,
      };
    },
  });

  return { regenerateShotsTool, localizeEpisodeTool };
}

/** A localize refusal as the contract's codes; anything else stays a fault. */
function asContractError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;

  if (error.name === 'LocalizationInProgress') {
    return new McpToolError('RUN_IN_PROGRESS', error.message);
  }

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

export const webStudioJobDeps: StudioJobDeps = {
  generation: generationToolDeps,
  localize: (client, userId, input) =>
    startEpisodeLocalization(client, userId, input),
};

const { regenerateShotsTool, localizeEpisodeTool } =
  createStudioJobTools(webStudioJobDeps);

export { regenerateShotsTool, localizeEpisodeTool };
export type { LocalizeDeps };
