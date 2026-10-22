import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllRows } from '@kit/shared/pagination';
import type { Database } from '@kit/supabase/database';

import {
  type YouTubeStagingView,
  youtubeStagingView,
} from '../lib/youtube-staging';

/**
 * A project's publishing calendar (FILM-2208's get_publish_calendar), as a
 * service so the morning digest (FILM-1735) reads the same posts the tool
 * does. Runs on the caller's client: RLS decides which posts are seen, and
 * the caller has already proved the project is its team's.
 */

type Client = SupabaseClient<Database>;

const CALENDAR_COLUMNS =
  'id, episode_id, platform, platform_connection_id, content_type, language, title, status, scheduled_at, slot_at, published_at, created_at, platform_url, metadata, release_priority, episodes!inner(title, number, slug, project_id, deleted_at)';

interface CalendarPublish {
  id: string;
  episode_id: string;
  platform: string;
  platform_connection_id: string | null;
  content_type: string;
  language: string | null;
  title: string | null;
  status: string;
  scheduled_at: string | null;
  slot_at: string | null;
  published_at: string | null;
  created_at: string;
  platform_url: string | null;
  metadata: unknown;
  release_priority: string;
  episodes: {
    title: string | null;
    number: number | null;
    slug: string | null;
    deleted_at: string | null;
  };
}

type CalendarPage = PromiseLike<{
  data: CalendarPublish[] | null;
  error: { message: string } | null;
}>;

export interface CalendarPost {
  publishId: string;
  episodeId: string;
  episodeTitle: string | null;
  episodeNumber: number | null;
  episodeSlug: string | null;
  platform: string;
  connectionId: string | null;
  contentType: string;
  language: string | null;
  title: string | null;
  /** The publish's status, or `held` for a Short no slot was found for */
  status: string;
  /** When it went, or goes, out; null for a held Short */
  at: string | null;
  platformUrl: string | null;
  error: string | null;
  heldReason: string | null;
  /** FILM-2210: part of a breaking-news release */
  breaking: boolean;
  /** KB-207: the post's episode was deleted */
  episodeDeleted: boolean;
  /** KB-207: why a `deleted` post was marked removed */
  removedReason: string | null;
  /**
   * KB-214: a YouTube post uploaded ahead of its time: when it goes public,
   * each time the HD gate held it, and whether it was flagged
   */
  youtube: YouTubeStagingView | null;
}

/** When a post goes, or went, out; else when it was made (a failed Publish Now, a held draft) */
function postTime(row: CalendarPublish) {
  return row.published_at ?? row.scheduled_at ?? row.slot_at ?? row.created_at;
}

/**
 * Every post of one project between `from` and `to` (ISO instants), in
 * time order, with the held Shorts last whatever the range. A post marked
 * removed (`deleted`, KB-207) only with `includeRemoved`: the Schedule page
 * shows it, the digest and MCP calendar do not.
 */
export async function readPublishCalendar(
  client: Client,
  input: { projectId: string; from: Date; to: Date; includeRemoved?: boolean },
): Promise<CalendarPost[]> {
  const [f, t] = [input.from.toISOString(), input.to.toISOString()];
  // Gone out in range; else due in range; else, with neither time, made in range
  const range = [
    `and(published_at.gte.${f},published_at.lte.${t})`,
    `and(published_at.is.null,scheduled_at.gte.${f},scheduled_at.lte.${t})`,
    `and(published_at.is.null,scheduled_at.is.null,created_at.gte.${f},created_at.lte.${t})`,
  ].join(',');

  const [dated, held] = await Promise.all([
    fetchAllRows<CalendarPublish>((start, end) => {
      const query = client
        .from('publishes')
        .select(CALENDAR_COLUMNS)
        .eq('episodes.project_id', input.projectId);

      return (input.includeRemoved ? query : query.neq('status', 'deleted'))
        .or(range)
        .order('id')
        .range(start, end) as unknown as CalendarPage;
    }, 'publish calendar'),
    // Held Shorts have no time: listed whatever the range
    fetchAllRows<CalendarPublish>(
      (start, end) =>
        client
          .from('publishes')
          .select(CALENDAR_COLUMNS)
          .eq('episodes.project_id', input.projectId)
          .eq('status', 'draft')
          .not('metadata->heldReason', 'is', null)
          .order('id')
          .range(start, end) as unknown as CalendarPage,
      'held shorts',
    ),
  ]);

  // A held draft made in the range comes back from both reads
  const byId = new Map([...dated, ...held].map((row) => [row.id, row]));

  const posts = [...byId.values()].map((row): CalendarPost => {
    const metadata = (row.metadata ?? {}) as {
      heldReason?: string;
      error?: string;
      removedReason?: string;
    };
    const isHeld = row.status === 'draft' && !!metadata.heldReason;

    return {
      publishId: row.id,
      episodeId: row.episode_id,
      episodeTitle: row.episodes.title,
      episodeNumber: row.episodes.number,
      episodeSlug: row.episodes.slug,
      platform: row.platform,
      connectionId: row.platform_connection_id,
      contentType: row.content_type,
      language: row.language,
      title: row.title,
      status: isHeld ? 'held' : row.status,
      // A held Short has no time until it is re-queued: listed last
      at: isHeld ? null : postTime(row),
      platformUrl: row.platform_url,
      error: row.status === 'failed' ? (metadata.error ?? null) : null,
      heldReason: isHeld ? (metadata.heldReason ?? null) : null,
      breaking: row.release_priority === 'breaking',
      episodeDeleted: row.episodes.deleted_at !== null,
      removedReason:
        row.status === 'deleted' ? (metadata.removedReason ?? null) : null,
      youtube:
        row.platform === 'youtube' ? youtubeStagingView(row.metadata) : null,
    };
  });

  // Ties by id, so the same posts always come back in the same order
  return posts.sort(
    (a, b) =>
      (a.at ?? '9').localeCompare(b.at ?? '9') ||
      a.publishId.localeCompare(b.publishId),
  );
}

export interface ScheduledThrough {
  connectionId: string;
  /** The last long video scheduled on the channel; null when none is */
  lastScheduledAt: string | null;
}

/**
 * When each of the project's channels runs out of scheduled long videos:
 * the latest `scheduled` full-length post after `after`, per channel. A
 * channel with none is listed by `connectionIds` with null.
 */
export async function readScheduledThrough(
  client: Client,
  input: { projectId: string; after: Date; connectionIds: string[] },
): Promise<ScheduledThrough[]> {
  type Row = {
    id: string;
    platform_connection_id: string | null;
    scheduled_at: string | null;
  };

  const rows = await fetchAllRows<Row>(
    (start, end) =>
      client
        .from('publishes')
        .select(
          'id, platform_connection_id, scheduled_at, episodes!inner(project_id)',
        )
        .eq('episodes.project_id', input.projectId)
        .eq('status', 'scheduled')
        .eq('content_type', 'full')
        .gte('scheduled_at', input.after.toISOString())
        .order('id')
        .range(start, end) as unknown as PromiseLike<{
        data: Row[] | null;
        error: { message: string } | null;
      }>,
    'scheduled long videos',
  );

  const last = new Map<string, string>();
  for (const row of rows) {
    if (!row.platform_connection_id || !row.scheduled_at) continue;

    const seen = last.get(row.platform_connection_id);
    if (!seen || row.scheduled_at > seen) {
      last.set(row.platform_connection_id, row.scheduled_at);
    }
  }

  const ids = [...new Set([...input.connectionIds, ...last.keys()])].sort();

  return ids.map((connectionId) => ({
    connectionId,
    lastScheduledAt: last.get(connectionId) ?? null,
  }));
}
