import 'server-only';

import { episodeVideoSaveRefusal } from '@kit/storage/episode-video';
import type { Database } from '@kit/supabase/database';
import type { getSupabaseServerClient } from '@kit/supabase/server-client';

import { OptimisticLockError } from './episode.service';

type Client = ReturnType<typeof getSupabaseServerClient<Database>>;

/** One Shorts group as `episodes.shorts_groups` stores it */
export interface StoredShortsGroup {
  id: string;
  name: string;
  title: string;
  description: string;
  tags: string[];
  videos: Record<string, string>;
  /** The platforms this cut goes to; none means every Shorts platform */
  platforms?: string[];
}

type Refused = { ok: false; refusal: string };

export const SHORTS_REFUSAL = "You can't change this episode's shorts.";

/**
 * Stores an episode's Shorts groups, for the Publish screen
 * (updateShortsGroupsAction) and the MCP Shorts tools alike. Every video
 * must be one of the episode's own uploads or one it already holds
 * (KB-123). With `expectedVersion`, the write lands only on that version of
 * the episode and throws OptimisticLockError otherwise.
 */
export async function saveShortsGroups(
  client: Client,
  input: {
    episodeId: string;
    shortsGroups: StoredShortsGroup[];
    expectedVersion?: number;
  },
): Promise<{ ok: true; version: number } | Refused> {
  const { data: episode, error: fetchError } = await client
    .from('episodes')
    .select('project_id, final_video_url, localized_videos, shorts_groups')
    .eq('id', input.episodeId)
    .single();

  if (fetchError) {
    throw new Error(`Failed to fetch episode: ${fetchError.message}`);
  }

  const refusal = episodeVideoSaveRefusal({
    episodeId: input.episodeId,
    projectId: episode.project_id,
    stored: episode,
    next: input.shortsGroups.flatMap((group) => Object.values(group.videos)),
  });

  if (refusal) {
    return { ok: false, refusal };
  }

  let update = client
    .from('episodes')
    .update({ shorts_groups: JSON.parse(JSON.stringify(input.shortsGroups)) })
    .eq('id', input.episodeId);

  if (input.expectedVersion !== undefined) {
    update = update.eq('version', input.expectedVersion);
  }

  const { data: updated, error: updateError } =
    await update.select('id, version');

  if (updateError) {
    throw new Error(`Failed to update shorts groups: ${updateError.message}`);
  }

  const row = updated?.[0];

  if (!row) {
    if (input.expectedVersion !== undefined) {
      throw new OptimisticLockError('episode');
    }

    return { ok: false, refusal: SHORTS_REFUSAL };
  }

  return { ok: true, version: row.version };
}

/**
 * Reads the groups, applies one edit and stores the result on the version
 * read, so an edit made in between is never overwritten: it throws
 * OptimisticLockError instead, and the caller reads again.
 */
export async function editShortsGroups<T>(
  client: Client,
  episodeId: string,
  edit: (
    groups: StoredShortsGroup[],
  ) => { ok: true; groups: StoredShortsGroup[]; result: T } | Refused,
): Promise<{ ok: true; result: T; groups: StoredShortsGroup[] } | Refused> {
  const { data: episode, error } = await client
    .from('episodes')
    .select('shorts_groups, version')
    .eq('id', episodeId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch episode: ${error.message}`);
  }

  if (!episode) {
    return { ok: false, refusal: 'Episode not found' };
  }

  const groups = Array.isArray(episode.shorts_groups)
    ? (episode.shorts_groups as unknown as StoredShortsGroup[])
    : [];
  const edited = edit(groups);

  if (!edited.ok) return edited;

  const saved = await saveShortsGroups(client, {
    episodeId,
    shortsGroups: edited.groups,
    expectedVersion: episode.version,
  });

  if (!saved.ok) return saved;

  return { ok: true, result: edited.result, groups: edited.groups };
}
