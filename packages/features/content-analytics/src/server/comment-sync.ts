import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { holdsRequirement } from '@kit/publishing/oauth/analytics-scopes';
import { getLogger } from '@kit/shared/logger';
import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
import type { Database } from '@kit/supabase/database';

import {
  type CommentFetch,
  type CommentFetchOptions,
  CommentScopeError,
  CommentVideoGoneError,
} from '../lib/audience-comments/fetched';
import {
  COMMENT_PLATFORMS,
  type CommentPlatform,
  isCommentPlatform,
} from '../lib/audience-comments/reaction';
import {
  type CommentSyncRecord,
  YOUTUBE_COMMENT_RETENTION_MS,
  planCommentSync,
} from '../lib/audience-comments/sync-schedule';
import { fetchFacebookComments } from '../providers/facebook/facebook-comments';
import { fetchInstagramComments } from '../providers/instagram/instagram-comments';
import { fetchYouTubeComments } from '../providers/youtube/youtube-comments';

/**
 * FILM-1733. Reads the comments on the team's published videos into
 * `audience_comments`, run hourly by the comment-sync cron.
 *
 * Each run:
 * 1. Deletes every YouTube comment the platform has not returned for 30
 *    days (Developer Policies III.E.4.c). This holds whatever else fails: a
 *    revoked token, a deleted video or a disconnected channel all stop the
 *    refresh, and the comment then ages out.
 * 2. Reads the videos that are due (lib/audience-comments/sync-schedule.ts):
 *    new comments for a recent read, every comment for a weekly refresh. A
 *    refresh that read everything deletes the stored comments it did not
 *    see, which the platform no longer has.
 * 3. Hands the projects with unlabelled comments to `labelComments`,
 *    which opens the server's labelling run, or leaves them for the team's
 *    AI over MCP.
 *
 * No author name or id is read into the table.
 */

type Client = SupabaseClient<Database>;

/** Videos read per run; a backlog drains over the following hours */
const BATCH = 40;

/** The requirement in `analytics-scopes.ts` each platform's read needs */
const REQUIREMENT: Record<CommentPlatform, string> = {
  youtube: 'youtube.comments',
  instagram: 'instagram.comments',
  facebook: 'facebook.comments',
};

/**
 * Whether a platform returns comments newest first, so a read of new ones
 * can stop at the last read. Instagram does not document its order, so its
 * every read is a full one.
 */
const NEWEST_FIRST: Record<CommentPlatform, boolean> = {
  youtube: true,
  instagram: false,
  facebook: true,
};

export type CommentFetcher = (
  accessToken: string,
  contentId: string,
  options: CommentFetchOptions,
) => Promise<CommentFetch>;

export const COMMENT_FETCHERS: Record<CommentPlatform, CommentFetcher> = {
  youtube: fetchYouTubeComments,
  instagram: fetchInstagramComments,
  facebook: fetchFacebookComments,
};

export interface CommentSyncDeps {
  client: Client;
  now: Date;
  fetchers: Record<CommentPlatform, CommentFetcher>;
  ensureValidToken: (
    connectionId: string,
  ) => Promise<{ valid: boolean; accessToken?: string; error?: string }>;
  /** Called once with every project that has unlabelled comments */
  labelComments: (projects: UnlabelledProject[]) => Promise<void>;
}

export interface CommentSyncResult {
  expired: number;
  due: number;
  read: number;
  stored: number;
  removed: number;
  failed: number;
  notAuthorised: number;
  projectsToLabel: number;
}

export interface UnlabelledProject {
  accountId: string;
  projectId: string;
}

interface Candidate {
  id: string;
  platform: CommentPlatform;
  platform_connection_id: string;
  platform_content_id: string;
  published_at: string;
}

interface Connection {
  id: string;
  account_id: string;
  scopes: string[] | null;
  disconnected_at: string | null;
}

export async function runCommentSync(
  deps: CommentSyncDeps,
): Promise<CommentSyncResult> {
  const logger = await getLogger();
  const ctx = { name: 'comment-sync' };
  const { client, now } = deps;

  const result: CommentSyncResult = {
    expired: 0,
    due: 0,
    read: 0,
    stored: 0,
    removed: 0,
    failed: 0,
    notAuthorised: 0,
    projectsToLabel: 0,
  };

  result.expired = await deleteExpiredYouTubeComments(client, now);

  const rows = await fetchAllRows<{
    id: string;
    platform: string;
    platform_connection_id: string | null;
    platform_content_id: string | null;
    published_at: string | null;
  }>(
    (from, to) =>
      client
        .from('publishes')
        .select(
          'id, platform, platform_connection_id, platform_content_id, published_at',
        )
        .in('status', ['published', 'unlisted'])
        .in('platform', [...COMMENT_PLATFORMS])
        .not('platform_content_id', 'is', null)
        .not('published_at', 'is', null)
        .order('id')
        .range(from, to),
    'comment sync publishes',
  );

  const candidates = rows.flatMap((row): Candidate[] =>
    isCommentPlatform(row.platform) &&
    row.platform_connection_id &&
    row.platform_content_id &&
    row.published_at
      ? [
          {
            id: row.id,
            platform: row.platform,
            platform_connection_id: row.platform_connection_id,
            platform_content_id: row.platform_content_id,
            published_at: row.published_at,
          },
        ]
      : [],
  );

  const [syncs, connections] = await Promise.all([
    readSyncs(
      client,
      candidates.map((c) => c.id),
    ),
    readConnections(client, candidates),
  ]);

  const plans = candidates
    .flatMap((publish) => {
      const connection = connections.get(publish.platform_connection_id);
      if (!connection || connection.disconnected_at) return [];

      const plan = planCommentSync({
        publishedAt: publish.published_at,
        sync: syncs.get(publish.id) ?? null,
        now,
      });

      return plan.due ? [{ publish, connection, plan }] : [];
    })
    .sort((a, b) => b.plan.urgency - a.plan.urgency);

  result.due = plans.length;

  for (const { publish, connection, plan } of plans.slice(0, BATCH)) {
    const record = (patch: Partial<SyncRow>) =>
      writeSync(client, publish.id, connection.account_id, now, patch);

    // A connection that recorded its grant and lacks the permission is a
    // known refusal: not tried, not a failure (FILM-1711's rule)
    if (
      connection.scopes !== null &&
      !holdsRequirement(REQUIREMENT[publish.platform], connection.scopes)
    ) {
      result.notAuthorised++;
      await record({
        last_status: 'not_authorised',
        last_error: null,
        last_synced_at: now.toISOString(),
      });
      continue;
    }

    const token = await deps.ensureValidToken(connection.id);

    if (!token.valid || !token.accessToken) {
      result.failed++;
      await record({
        last_status: 'failed',
        last_error: token.error ?? 'The channel’s token could not be refreshed',
        consecutive_failures:
          (syncs.get(publish.id)?.consecutive_failures ?? 0) + 1,
      });
      continue;
    }

    const refresh = plan.refresh || !NEWEST_FIRST[publish.platform];

    try {
      const fetched = await deps.fetchers[publish.platform](
        token.accessToken,
        publish.platform_content_id,
        {
          since: refresh ? undefined : (plan.since ?? undefined),
          maxPages: refresh ? 50 : 5,
        },
      );

      result.read++;
      result.stored += await storeComments(
        client,
        publish,
        connection.account_id,
        fetched,
        now,
      );

      if (refresh && fetched.complete) {
        result.removed += await removeUnreturned(client, publish.id, now);
      }

      await record({
        last_status: 'ok',
        last_error: null,
        consecutive_failures: 0,
        last_synced_at: now.toISOString(),
        ...(refresh && fetched.complete
          ? { last_refreshed_at: now.toISOString() }
          : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (error instanceof CommentScopeError) {
        result.notAuthorised++;
        await record({ last_status: 'not_authorised', last_error: message });
        continue;
      }

      result.failed++;
      logger.warn(
        { ...ctx, publishId: publish.id, error: message },
        'read failed',
      );
      await record({
        last_status: 'failed',
        last_error:
          error instanceof CommentVideoGoneError
            ? 'The platform no longer has this video'
            : message.slice(0, 1000),
        consecutive_failures:
          (syncs.get(publish.id)?.consecutive_failures ?? 0) + 1,
      });
    }
  }

  const projects = await projectsWithUnlabelledComments(client);
  result.projectsToLabel = projects.length;
  if (projects.length) await deps.labelComments(projects);

  logger.info({ ...ctx, ...result }, 'comment sync finished');

  return result;
}

async function deleteExpiredYouTubeComments(client: Client, now: Date) {
  const cutoff = new Date(
    now.getTime() - YOUTUBE_COMMENT_RETENTION_MS,
  ).toISOString();

  const { count, error } = await client
    .from('audience_comments')
    .delete({ count: 'exact' })
    .eq('platform', 'youtube')
    .lt('fetched_at', cutoff);

  // The one rule that must hold: a failed delete fails the run, loudly
  if (error) {
    throw new Error(
      `Could not delete expired YouTube comments: ${error.message}`,
    );
  }

  return count ?? 0;
}

type SyncRow = Database['public']['Tables']['audience_comment_syncs']['Insert'];

async function readSyncs(client: Client, publishIds: string[]) {
  const rows = await fetchAllByIds<CommentSyncRecord & { publish_id: string }>(
    publishIds,
    (chunk, from, to) =>
      client
        .from('audience_comment_syncs')
        .select(
          'publish_id, last_synced_at, last_refreshed_at, last_status, consecutive_failures, updated_at',
        )
        .in('publish_id', chunk)
        .order('publish_id')
        .range(from, to),
    'comment syncs',
  );

  return new Map(rows.map((row) => [row.publish_id, row]));
}

async function readConnections(client: Client, candidates: Candidate[]) {
  const rows = await fetchAllByIds<Connection>(
    [...new Set(candidates.map((c) => c.platform_connection_id))],
    (chunk, from, to) =>
      client
        .from('platform_connections')
        .select('id, account_id, scopes, disconnected_at')
        .in('id', chunk)
        .order('id')
        .range(from, to),
    'comment sync connections',
  );

  return new Map(rows.map((row) => [row.id, row]));
}

async function writeSync(
  client: Client,
  publishId: string,
  accountId: string,
  now: Date,
  patch: Partial<SyncRow>,
) {
  const { error } = await client.from('audience_comment_syncs').upsert(
    {
      publish_id: publishId,
      account_id: accountId,
      updated_at: now.toISOString(),
      ...patch,
    },
    { onConflict: 'publish_id' },
  );

  if (error) {
    throw new Error(`Could not record the comment sync: ${error.message}`);
  }
}

/** Upserts the fetched comments, stamping each as returned now */
async function storeComments(
  client: Client,
  publish: Candidate,
  accountId: string,
  fetched: CommentFetch,
  now: Date,
) {
  const rows = fetched.comments.map((comment) => ({
    account_id: accountId,
    platform_connection_id: publish.platform_connection_id,
    publish_id: publish.id,
    platform: publish.platform,
    platform_comment_id: comment.platformCommentId,
    parent_platform_comment_id: comment.parentPlatformCommentId,
    text: comment.text,
    like_count: comment.likeCount,
    reply_count: comment.replyCount,
    commented_at: comment.commentedAt,
    fetched_at: now.toISOString(),
  }));

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await client
      .from('audience_comments')
      .upsert(rows.slice(i, i + 500), {
        onConflict: 'platform,platform_comment_id',
      });

    if (error) throw new Error(`Could not store comments: ${error.message}`);
  }

  return rows.length;
}

/** After a complete read: the stored comments it did not return are gone */
async function removeUnreturned(client: Client, publishId: string, now: Date) {
  const { count, error } = await client
    .from('audience_comments')
    .delete({ count: 'exact' })
    .eq('publish_id', publishId)
    .lt('fetched_at', now.toISOString());

  if (error) {
    throw new Error(`Could not remove deleted comments: ${error.message}`);
  }

  return count ?? 0;
}

/** Projects with at least one comment that has no label */
export async function projectsWithUnlabelledComments(
  client: Client,
): Promise<UnlabelledProject[]> {
  const { data, error } = await client.rpc('projects_with_unlabelled_comments');

  if (error) {
    throw new Error(`Could not find unlabelled comments: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    accountId: row.account_id,
    projectId: row.project_id,
  }));
}
