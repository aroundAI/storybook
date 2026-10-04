import 'server-only';

import {
  CreateEpisodeSchema,
  UpdateEpisodeSchema,
} from '@kit/episodes/schemas';
import { CreateEpisodeWithContextSchema } from '@kit/episodes/schemas/create-episode-wizard';
import {
  OptimisticLockError,
  insertEpisode,
  updateEpisodeRow,
} from '@kit/episodes/server/episode-service';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import { episodeSummary } from '../read/episodes';
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
    'Creates an episode in draft, validated as the web dialog and wizard are: title 1-255 characters, optional description (the logline) up to 2000, optional episode number (auto-assigned when absent), optional season, and the creative direction the story stage reads: target duration 60-7200 seconds, content style (dialogue-heavy, action-heavy, balanced), visual tone and tone notes. Writes no story, screenplay or shots: those come from the generation tools.',
  inputSchema: {
    ...CreateEpisodeSchema.shape,
    targetDuration: targetDuration.describe(
      'Target running time in seconds, 60-7200.',
    ),
    contentStyle,
    visualTone,
    toneNotes,
  },
  scope: 'studio:write',
  annotations: WRITE,
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireProjectInAccount(client, context.accountId, input.projectId);

    const result = await insertEpisode(client, {
      projectId: input.projectId,
      seasonId: input.seasonId ?? null,
      number: input.number,
      title: input.title,
      description: input.description ?? null,
      metadata: creativeDirectionMetadata(input),
      targetDurationSeconds: input.targetDuration ?? null,
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
    "Changes an episode's title, description (logline), target duration, content style, visual tone or tone notes, under optimistic locking: pass the version get_episode returned, and the call fails with TARGET_CHANGED if the episode moved since. Never writes the story, screenplay, shots, dialogue or audio.",
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

    if (
      Object.keys(fields).length === 0 &&
      Object.keys(metadataPatch).length === 0
    ) {
      throw refused('Give at least one field to change.');
    }

    let result;

    try {
      result = await updateEpisodeRow(client, {
        episodeId: input.episodeId,
        version: input.version,
        ...fields,
        ...(Object.keys(metadataPatch).length > 0 ? { metadataPatch } : {}),
      });
    } catch (error) {
      if (error instanceof OptimisticLockError) {
        throw new McpToolError(
          'TARGET_CHANGED',
          'The episode changed since you read it. Call get_episode and retry with the new version.',
          { details: { episodeId: input.episodeId, version: input.version } },
        );
      }

      throw error;
    }

    if (!result.ok) {
      throw new McpToolError('NOT_FOUND', result.message, {
        details: { episodeId: input.episodeId },
      });
    }

    const episode = episodeSummary(result.data);

    return {
      text: `Updated episode #${episode.number} "${episode.title}" to version ${episode.version}.`,
      structuredContent: { episode },
    };
  },
});
