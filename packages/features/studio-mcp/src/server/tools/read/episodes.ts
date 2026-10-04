import 'server-only';

import { z } from 'zod';

import { parseEditState } from '@kit/desktop-integration';
import { getOpenEditSession } from '@kit/desktop-integration/server';
import { EpisodeStatusSchema } from '@kit/episodes/schemas';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import {
  AfterCursor,
  PAGING_NOTE,
  cursorArg,
  decodeCursor,
  encodeCursor,
  limitArg,
  pageOf,
} from '../pagination';
import {
  type EpisodeRef,
  requireEpisodeInAccount,
  requireProjectInAccount,
} from './scope';
import { EPISODE_STATUS_ORDER, deriveStages } from './stage-status';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export interface EpisodeRowLike {
  id: string;
  project_id: string;
  season_id: string | null;
  number: number;
  slug: string | null;
  title: string;
  description: string | null;
  status: string;
  version: number;
  metadata: unknown;
  target_duration_seconds: number | null;
  duration_seconds?: number | null;
  thumbnail_url?: string | null;
  final_video_url?: string | null;
  created_at: string;
  updated_at: string;
}

export const EPISODE_LIST_COLUMNS =
  'id, project_id, season_id, number, slug, title, description, status, version, metadata, target_duration_seconds, duration_seconds, thumbnail_url, final_video_url, created_at, updated_at';

/**
 * An episode as the tools present it. The creative direction the wizard
 * stores in `metadata` (content style, visual tone, tone notes) is picked
 * out by name; the target duration is the column, falling back to the
 * metadata copy older episodes carry.
 */
export function episodeSummary(row: EpisodeRowLike) {
  const metadata = (row.metadata as Record<string, unknown> | null) ?? {};

  return {
    id: row.id,
    projectId: row.project_id,
    seasonId: row.season_id,
    number: row.number,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    version: row.version,
    targetDurationSeconds:
      row.target_duration_seconds ??
      (typeof metadata.target_duration === 'number'
        ? metadata.target_duration
        : null),
    contentStyle: (metadata.content_style as string | undefined) ?? null,
    visualTone: (metadata.visual_tone as string | undefined) ?? null,
    toneNotes: (metadata.tone_notes as string | undefined) ?? null,
    durationSeconds: row.duration_seconds ?? null,
    thumbnailUrl: row.thumbnail_url ?? null,
    finalVideoUrl: row.final_video_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const listEpisodesTool = defineTool({
  name: 'list_episodes',
  title: 'List episodes',
  description: `The episodes of one project in number order, without their stage content (use get_episode). Deleted episodes are not listed. ${PAGING_NOTE} Filter by status or season.`,
  inputSchema: {
    projectId: z
      .string()
      .uuid()
      .describe('The project id (from list_projects).'),
    seasonId: z.string().uuid().optional().describe('Only this season.'),
    status: EpisodeStatusSchema.optional().describe(
      `Only this status; the order is ${EPISODE_STATUS_ORDER.join(' → ')}.`,
    ),
    cursor: cursorArg,
    limit: limitArg,
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireProjectInAccount(client, context.accountId, input.projectId);

    const after = decodeCursor(input.cursor, AfterCursor)?.after;

    let query = client
      .from('episodes')
      .select(EPISODE_LIST_COLUMNS)
      .eq('project_id', input.projectId)
      .is('deleted_at', null);

    if (input.seasonId) query = query.eq('season_id', input.seasonId);
    if (input.status) query = query.eq('status', input.status);
    if (after !== undefined) query = query.gt('number', after);

    const { data, error } = await query
      .order('number', { ascending: true })
      .limit(input.limit + 1);

    if (error) {
      throw new McpToolError('INTERNAL', 'Could not list the episodes.');
    }

    const { items, hasMore } = pageOf(
      (data ?? []) as unknown as EpisodeRowLike[],
      input.limit,
    );
    const episodes = items.map(episodeSummary);
    const last = episodes[episodes.length - 1];

    return {
      text: `${episodes.length} episode${episodes.length === 1 ? '' : 's'}${hasMore ? ' (more follow)' : ''}: ${episodes.map((e) => `#${e.number} "${e.title}" (${e.status})`).join(', ') || 'none'}.`,
      structuredContent: {
        projectId: input.projectId,
        episodes,
        nextCursor:
          hasMore && last ? encodeCursor({ after: last.number }) : null,
      },
    };
  },
});

interface ScreenplayLike {
  scenes?: Array<{
    number?: number;
    heading?: string;
    dialogue?: unknown[];
    estimatedDuration?: number;
  }>;
  metadata?: {
    totalScenes?: number;
    estimatedDuration?: number;
    locations?: string[];
    characters?: string[];
  };
}

type EpisodeDetailRow = EpisodeRowLike &
  EpisodeRef & {
    story_data: unknown;
    screenplay_data: unknown;
    shot_list: unknown;
    generation_origin: unknown;
    final_video_url: string | null;
    edit_state: unknown;
  };

const EPISODE_DETAIL_COLUMNS = `${EPISODE_LIST_COLUMNS}, story_data, screenplay_data, shot_list, generation_origin, edit_state`;

export const getEpisodeTool = defineTool({
  name: 'get_episode',
  title: 'Get episode',
  description:
    'One episode with its stage status (the workflow draft → story → storyboard → generating → editing → ready → published, and each studio stage as locked, available or done), the story, a screenplay summary, counts of scenes, shots, dialogue lines and assets, the origin of each stage when recorded, and its StorybookStudio edit state (editState, and editSession while one is open). Use get_screenplay, get_shots and get_dialogue for the full stage content.',
  inputSchema: {
    episodeId: z
      .string()
      .uuid()
      .describe('The episode id (from list_episodes).'),
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const client = context.principal.supabase;
    const episode = await requireEpisodeInAccount<EpisodeDetailRow>(
      client,
      context.accountId,
      input.episodeId,
      EPISODE_DETAIL_COLUMNS,
    );

    const metadata = (episode.metadata as Record<string, unknown> | null) ?? {};
    const taggedAssetIds = [
      ...((metadata.character_ids as string[] | undefined) ?? []),
      ...((metadata.location_ids as string[] | undefined) ?? []),
    ];

    const [shots, dialogue, audioCues, attachedAssets, editSession] =
      await Promise.all([
        client
          .from('shots')
          .select('id', { count: 'exact', head: true })
          .eq('episode_id', episode.id)
          .is('deleted_at', null),
        client
          .from('dialogue_lines')
          .select('id', { count: 'exact', head: true })
          .eq('episode_id', episode.id),
        client
          .from('audio_cues')
          .select('id', { count: 'exact', head: true })
          .eq('episode_id', episode.id),
        client
          .from('assets')
          .select('id', { count: 'exact', head: true })
          .eq('episode_id', episode.id)
          .is('deleted_at', null),
        // FILM-2002: who is editing it in the Studio, if anyone
        getOpenEditSession(client, episode.id).catch(() => {
          throw new McpToolError(
            'INTERNAL',
            'Could not read the edit session.',
          );
        }),
      ]);

    if (
      shots.error ||
      dialogue.error ||
      audioCues.error ||
      attachedAssets.error
    ) {
      throw new McpToolError(
        'INTERNAL',
        'Could not count the episode content.',
      );
    }

    // episodes.generation_origin (FILM-1903) is keyed by stage and stamped by
    // every commit; `{}` means no generated stage has been committed yet.
    const origin =
      episode.generation_origin && typeof episode.generation_origin === 'object'
        ? (episode.generation_origin as Record<string, unknown>)
        : {};

    const screenplay =
      (episode.screenplay_data as ScreenplayLike | null) ?? null;
    const scenes = screenplay?.scenes ?? [];
    const counts = {
      scenes: scenes.length,
      shots: shots.count ?? 0,
      dialogueLines: dialogue.count ?? 0,
      assets: (attachedAssets.count ?? 0) + taggedAssetIds.length,
    };

    const stages = deriveStages({
      status: episode.status,
      storyData: episode.story_data,
      screenplayData: episode.screenplay_data,
      shotList: episode.shot_list,
      finalVideoUrl: episode.final_video_url ?? null,
      shotCount: counts.shots,
      dialogueLineCount: counts.dialogueLines,
      audioCueCount: audioCues.count ?? 0,
      origin,
    });

    const screenplaySummary = screenplay
      ? {
          scenes: scenes.length,
          headings: scenes.map((scene) => scene.heading ?? ''),
          dialogueLines: scenes.reduce(
            (sum, scene) => sum + (scene.dialogue?.length ?? 0),
            0,
          ),
          estimatedDurationSeconds:
            screenplay.metadata?.estimatedDuration ??
            scenes.reduce(
              (sum, scene) => sum + (scene.estimatedDuration ?? 0),
              0,
            ),
          locations: screenplay.metadata?.locations ?? [],
          characters: screenplay.metadata?.characters ?? [],
        }
      : null;

    const summary = episodeSummary(episode);
    const editingLine = editSession
      ? ` Being edited in the Studio since ${editSession.started_at} (session ${editSession.id}).`
      : '';
    const stageLine = stages
      .map((stage) => `${stage.label}: ${stage.state}`)
      .join(', ');

    return {
      text: `Episode #${summary.number} "${summary.title}" is ${summary.status}. ${stageLine}. ${counts.scenes} scenes, ${counts.shots} shots, ${counts.dialogueLines} dialogue lines, ${counts.assets} assets.${editingLine}`,
      structuredContent: {
        episode: summary,
        project: {
          id: episode.project.id,
          name: episode.project.name,
          slug: episode.project.slug,
        },
        statusOrder: EPISODE_STATUS_ORDER,
        stages,
        editState: parseEditState(episode.edit_state),
        editSession: editSession
          ? {
              id: editSession.id,
              userId: editSession.user_id,
              connectionId: editSession.connection_id,
              packageEtag: editSession.package_etag,
              previousStatus: editSession.previous_status,
              startedAt: editSession.started_at,
              lastEventAt: editSession.last_event_at,
            }
          : null,
        story: episode.story_data ?? null,
        screenplaySummary,
        counts,
        origin: {
          perStage: origin,
          note:
            Object.keys(origin).length > 0
              ? 'From episodes.generation_origin, stamped by each stage commit (FILM-1903): kind server, external or human, with the run, model and client.'
              : 'No stage of this episode has been committed by a generation run yet; a hand-written story or screenplay carries no origin.',
        },
      },
    };
  },
});
