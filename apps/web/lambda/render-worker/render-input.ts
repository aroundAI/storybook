/**
 * What a render reads from the database, and which clips it keeps.
 *
 * The column lists are the only place the worker names edit-suite columns.
 * With the client typed by `Database`, a list that names a column the
 * tables do not have makes its rows unassignable to the renderer's types,
 * so `pnpm typecheck` fails instead of every render failing at runtime
 * (KB-32: the worker selected `canvas_width`, `trim_start_ms`, `time_ms`…,
 * none of which exist, and every export died on a 42703).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
import type { Database, Tables } from '@kit/supabase/database';

export type RenderProject = Pick<
  Tables<'edit_projects'>,
  'id' | 'episode_id' | 'width' | 'height' | 'fps'
>;

export type RenderTrack = Pick<
  Tables<'edit_tracks'>,
  'id' | 'type' | 'name' | 'sort_order' | 'volume' | 'is_muted'
>;

export type RenderClip = Pick<
  Tables<'edit_clips'>,
  | 'id'
  | 'track_id'
  | 'media_url'
  | 'start_ms'
  | 'end_ms'
  | 'in_point_ms'
  | 'out_point_ms'
  | 'volume'
  | 'speed'
  | 'fade_in_ms'
  | 'fade_out_ms'
  | 'language'
  | 'is_active'
>;

const PROJECT_COLUMNS = 'id, episode_id, width, height, fps';
const TRACK_COLUMNS = 'id, type, name, sort_order, volume, is_muted';
const CLIP_COLUMNS =
  'id, track_id, media_url, start_ms, end_ms, in_point_ms, out_point_ms, volume, speed, fade_in_ms, fade_out_ms, language, is_active';

/**
 * A failure the user sees as `render_error`. The message names the stage;
 * the database's own error is logged by the caller, not shown.
 */
export class RenderStageError extends Error {
  constructor(
    message: string,
    readonly detail?: { code?: string; message?: string },
  ) {
    super(message);
    this.name = 'RenderStageError';
  }
}

export interface RenderInputRows {
  project: RenderProject;
  tracks: RenderTrack[];
  clips: RenderClip[];
}

/**
 * Marks the project `rendering` and reads everything the render needs.
 *
 * Tracks and clips are paged: PostgREST caps a response at 1000 rows with
 * no error, and a render missing clips would look like a finished one.
 */
export async function loadRenderInput(
  db: SupabaseClient<Database>,
  editProjectId: string,
): Promise<RenderInputRows> {
  const { data: project, error } = await db
    .from('edit_projects')
    .update({
      render_status: 'rendering',
      render_started_at: new Date().toISOString(),
      render_error: null,
    })
    .eq('id', editProjectId)
    .select(PROJECT_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new RenderStageError(
      `Could not load the edit project (${error.code})`,
      error,
    );
  }

  if (!project) {
    throw new RenderStageError('Edit project not found');
  }

  try {
    const tracks = await fetchAllRows<RenderTrack>(
      (from, to) =>
        db
          .from('edit_tracks')
          .select(TRACK_COLUMNS)
          .eq('edit_project_id', editProjectId)
          .order('id')
          .range(from, to),
      'edit_tracks',
    );

    const clips = await fetchAllByIds<RenderClip>(
      tracks.map((track) => track.id),
      (trackIds, from, to) =>
        db
          .from('edit_clips')
          .select(CLIP_COLUMNS)
          .in('track_id', trackIds)
          .order('id')
          .range(from, to),
      'edit_clips',
    );

    return { project, tracks, clips };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    throw new RenderStageError('Could not load the timeline', { message });
  }
}

/**
 * The clips a render for `language` includes.
 *
 * `is_active` is the editor's *preview* toggle: switching the preview
 * language flips it on every clip that has a language, and auto-assemble
 * writes non-preview dubs as inactive. So it decides only for clips with
 * no language. A clip with a language is in exactly the renders for its
 * language, whatever the preview shows ("Each job activates only the clips
 * matching that language", phase-14 ENGINEERING.md, Per-Language Export).
 */
export function selectRenderClips(
  tracks: RenderTrack[],
  clips: RenderClip[],
  language: string,
): RenderClip[] {
  const trackById = new Map(tracks.map((track) => [track.id, track]));

  return clips.filter((clip) => {
    const track = trackById.get(clip.track_id);

    if (!track || track.is_muted) return false;

    if (clip.language) return clip.language === language;

    return clip.is_active;
  });
}
