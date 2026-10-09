import 'server-only';

import { z } from 'zod';

import {
  CreateEpisodeSchema,
  UpdateEpisodeSchema,
} from '@kit/episodes/schemas';
import {
  START_FROM,
  START_PLAN,
} from '@kit/episodes/schemas/create-episode-start';
import { CreateEpisodeWithContextSchema } from '@kit/episodes/schemas/create-episode-wizard';
import {
  OptimisticLockError,
  insertEpisode,
  updateEpisodeRow,
} from '@kit/episodes/server/episode-service';
import { followUpMetadata } from '@kit/episodes/server/follow-up-service';
import { moveEpisodeToSeason } from '@kit/episodes/server/season-service';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import {
  EPISODE_LIST_COLUMNS,
  type EpisodeRowLike,
  episodeSummary,
} from '../read/episodes';
import {
  requireEpisodeInAccount,
  requireProjectInAccount,
} from '../read/scope';
import { compact, refused } from '../validation';

const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/**
 * The creative direction the create-episode wizard takes. It lands in
 * `episodes.metadata` (and `target_duration_seconds`) exactly as the wizard
 * writes it, never in story_data: the logline is the episode description.
 */
const { targetDuration, contentStyle, visualTone, toneNotes } =
  CreateEpisodeWithContextSchema.shape;

function creativeDirectionMetadata(input: {
  contentStyle?: string;
  targetDuration?: number;
  visualTone?: string;
  toneNotes?: string;
}) {
  const metadata: Record<string, unknown> = {};

  if (input.visualTone) metadata.visual_tone = input.visualTone;
  if (input.toneNotes) metadata.tone_notes = input.toneNotes;
  if (input.contentStyle) metadata.content_style = input.contentStyle;
  if (input.targetDuration) metadata.target_duration = input.targetDuration;

  return metadata;
}

export const createEpisodeTool = defineTool({
  name: 'create_episode',
  title: 'Create episode',
  description:
    'Creates an episode in draft, validated as the web dialog and wizard are: title 1-255 characters, optional description (the logline) up to 2000, optional episode number (auto-assigned when absent), optional season, how it starts (startFrom: idea, script or video), and the creative direction the story stage reads: target duration 60-7200 seconds, content style (dialogue-heavy, action-heavy, balanced), visual tone and tone notes. Writes no story, screenplay or shots: those come from the generation tools, or import_screenplay for a finished script.',
  inputSchema: {
    ...CreateEpisodeSchema.shape,
    targetDuration: targetDuration.describe(
      'Target running time in seconds, 60-7200.',
    ),
    contentStyle,
    visualTone,
    toneNotes,
    startFrom: z
      .enum(START_FROM)
      .optional()
      .describe(
        'How the episode starts (FILM-2205): idea (default), script (then import_screenplay; ideation and story are skipped) or video (then request_episode_video_upload or link_published_video; every stage before publish is skipped).',
      ),
    followUpOf: z
      .string()
      .uuid()
      .optional()
      .describe(
        'FILM-2206: an episode of the same project this one follows up. Its traits and numbers are frozen into this episode, and the story brief leads its performance context with them.',
      ),
  },
  scope: 'studio:write',
  annotations: WRITE,
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireProjectInAccount(client, context.accountId, input.projectId);

    let followUp: Record<string, unknown> = {};

    if (input.followUpOf) {
      // Only the story brief reads it, and a script or video skips story
      if ((input.startFrom ?? 'idea') !== 'idea') {
        throw refused(
          'A follow-up starts from an idea: its story brief is what reads the episode it follows up.',
          'followUpOf',
        );
      }

      const built = await followUpMetadata(client, {
        projectId: input.projectId,
        episodeId: input.followUpOf,
      });

      if (!built.ok) throw refused(built.refusal, 'followUpOf');
      followUp = built.metadata;
    }

    const result = await insertEpisode(client, {
      projectId: input.projectId,
      seasonId: input.seasonId ?? null,
      number: input.number,
      title: input.title,
      description: input.description ?? null,
      metadata: { ...creativeDirectionMetadata(input), ...followUp },
      targetDurationSeconds: input.targetDuration ?? null,
      entryMode: input.startFrom ?? 'idea',
      skippedStages: START_PLAN[input.startFrom ?? 'idea'].skipped,
    });

    if (!result.ok) {
      throw refused(result.refusal, result.field);
    }

    const episode = episodeSummary(result.data);

    return {
      text: `Created episode #${episode.number} "${episode.title}" (${episode.id}) in draft.`,
      structuredContent: { episode },
    };
  },
});

const { episodeId, version, title, description } = UpdateEpisodeSchema.shape;

export const updateEpisodeTool = defineTool({
  name: 'update_episode',
  title: 'Update episode',
  description:
    "Changes an episode's title, description (logline), target duration, content style, visual tone or tone notes, or moves it to another season (seasonId; null for Unsorted), under optimistic locking: pass the version get_episode returned, and the call fails with TARGET_CHANGED if the episode moved since. Moving never renumbers the episode. Never writes the story, screenplay, shots, dialogue or audio.",
  inputSchema: {
    episodeId,
    version: version.describe('The version from get_episode or list_episodes.'),
    title,
    description,
    targetDuration: targetDuration.describe(
      'Target running time in seconds, 60-7200.',
    ),
    contentStyle,
    visualTone,
    toneNotes,
    seasonId: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .describe(
        'Move the episode to this season of its project, or null for Unsorted.',
      ),
  },
  scope: 'studio:write',
  annotations: { ...WRITE, idempotentHint: true },
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireEpisodeInAccount(
      client,
      context.accountId,
      input.episodeId,
      'id, version',
    );

    const metadataPatch = creativeDirectionMetadata(input);
    const fields = compact({
      title: input.title,
      description: input.description,
      targetDurationSeconds: input.targetDuration,
    });
    const editsFields =
      Object.keys(fields).length > 0 || Object.keys(metadataPatch).length > 0;

    if (!editsFields && input.seasonId === undefined) {
      throw refused('Give at least one field to change.');
    }

    const changed = () =>
      new McpToolError(
        'TARGET_CHANGED',
        'The episode changed since you read it. Call get_episode and retry with the new version.',
        { details: { episodeId: input.episodeId, version: input.version } },
      );

    let version = input.version;
    let episode;

    try {
      if (editsFields) {
        const result = await updateEpisodeRow(client, {
          episodeId: input.episodeId,
          version,
          ...fields,
          ...(Object.keys(metadataPatch).length > 0 ? { metadataPatch } : {}),
        });

        if (!result.ok) {
          throw new McpToolError('NOT_FOUND', result.message, {
            details: { episodeId: input.episodeId },
          });
        }

        episode = episodeSummary(result.data);
        version = result.data.version;
      }

      if (input.seasonId !== undefined) {
        const moved = await moveEpisodeToSeason(client, {
          episodeId: input.episodeId,
          version,
          seasonId: input.seasonId,
        });

        if (!moved.ok) {
          throw moved.reason === 'not_found'
            ? new McpToolError('NOT_FOUND', moved.refusal)
            : refused(moved.refusal, 'seasonId');
        }
      }
    } catch (error) {
      if (error instanceof OptimisticLockError) throw changed();
      throw error;
    }

    // Read back once, so the answer carries every change and the new version
    const { data: row, error: readError } = await client
      .from('episodes')
      .select(EPISODE_LIST_COLUMNS)
      .eq('id', input.episodeId)
      .maybeSingle();

    if (readError || !row) {
      throw new McpToolError('INTERNAL', 'Could not read the episode back.');
    }

    episode = episodeSummary(row as unknown as EpisodeRowLike);

    return {
      text: `Updated episode #${episode.number} "${episode.title}" to version ${episode.version}${input.seasonId !== undefined ? (input.seasonId ? ' in its new season' : ', now Unsorted') : ''}.`,
      structuredContent: { episode },
    };
  },
});
