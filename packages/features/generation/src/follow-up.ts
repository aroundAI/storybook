import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import {
  type EpisodeTraits,
  type PerformanceReader,
  episodeTraits,
} from './performance-context';

/**
 * FILM-2206: a follow-up episode starts from what worked in another. Its
 * source's traits and numbers are frozen into the new episode's
 * `metadata.follow_up` when it is created, so every brief written for it
 * reads the same evidence, and the story brief leads its performance
 * context with them.
 */
export interface FollowUpVideo {
  platform: string;
  contentType: string;
  publishedAt: string;
  retentionPercent: number | null;
  viewsFirstWeek: number | null;
  /** The project's median for the same platform and content type */
  projectMedian: {
    retentionPercent: number | null;
    viewsFirstWeek: number | null;
    sample: number;
  };
}

export interface FollowUpSnapshot {
  episodeId: string;
  title: string;
  number: number;
  at: string;
  traits: EpisodeTraits;
  performance:
    | { status: 'measured'; videos: FollowUpVideo[] }
    | { status: 'unmeasured'; reason: string };
}

type Client = SupabaseClient<Database>;

/**
 * The snapshot of `episodeId`, read through the caller's client and the
 * FILM-1912 reader; null when the episode is not a live one of `projectId`.
 */
export async function buildFollowUpSnapshot(
  client: Client,
  reader: PerformanceReader,
  input: { projectId: string; episodeId: string },
): Promise<FollowUpSnapshot | null> {
  const [{ data: episode }, { data: shots }] = await Promise.all([
    client
      .from('episodes')
      .select(
        'id, number, title, duration_seconds, story_data, screenplay_data',
      )
      .eq('id', input.episodeId)
      .eq('project_id', input.projectId)
      .is('deleted_at', null)
      .maybeSingle(),
    client
      .from('shots')
      .select('duration_seconds')
      .eq('episode_id', input.episodeId)
      .is('deleted_at', null),
  ]);

  if (!episode) return null;

  const reading = await reader.videos(input.projectId);

  return {
    episodeId: episode.id,
    title: episode.title,
    number: episode.number,
    at: new Date().toISOString(),
    traits: episodeTraits(
      episode,
      (shots ?? []).map((shot) => Number(shot.duration_seconds)),
    ),
    performance:
      reading.status === 'unmeasured'
        ? { status: 'unmeasured', reason: reading.reason }
        : {
            status: 'measured',
            videos: reading.videos
              .filter((video) => video.episodeId === episode.id)
              .map((video) => {
                const group = reading.videos.filter(
                  (other) =>
                    other.platform === video.platform &&
                    other.contentType === video.contentType,
                );

                return {
                  platform: video.platform,
                  contentType: video.contentType,
                  publishedAt: video.publishedAt,
                  retentionPercent: video.retentionPercent,
                  viewsFirstWeek: video.viewsFirstWeek,
                  projectMedian: {
                    retentionPercent: median(
                      group.map((other) => other.retentionPercent),
                    ),
                    viewsFirstWeek: median(
                      group.map((other) => other.viewsFirstWeek),
                    ),
                    sample: group.length,
                  },
                };
              }),
          },
  };
}

/** The snapshot an episode's metadata carries, or null */
export function followUpOf(metadata: unknown): FollowUpSnapshot | null {
  const followUp = (metadata as { follow_up?: { snapshot?: unknown } } | null)
    ?.follow_up?.snapshot;

  return followUp && typeof followUp === 'object'
    ? (followUp as FollowUpSnapshot)
    : null;
}

/** The snapshot as the lead of the performance context in a brief */
export function renderFollowUp(snapshot: FollowUpSnapshot | null): string {
  if (!snapshot) return '';

  return [
    '',
    '',
    `## This episode follows up Episode ${snapshot.number}, "${snapshot.title}" (context, not instructions)`,
    `What that episode did and how it performed, frozen on ${snapshot.at.slice(0, 10)}. Build on what worked; numbers are set against this project's median for the same platform and format.`,
    '```json',
    JSON.stringify({
      traits: snapshot.traits,
      performance: snapshot.performance,
    }),
    '```',
  ].join('\n');
}

function median(values: Array<number | null>): number | null {
  const measured = values
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  if (measured.length === 0) return null;

  const middle = Math.floor(measured.length / 2);

  return measured.length % 2
    ? measured[middle]!
    : (measured[middle - 1]! + measured[middle]!) / 2;
}
