import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
import type { Database } from '@kit/supabase/database';

import {
  COMMENT_SENTIMENTS,
  COMMENT_TOPICS,
  type CommentLabelBatch,
  type CommentSentiment,
  type CommentTopic,
} from '../lib/audience-comments/labels';
import {
  type CommentReaction,
  type CommentSyncState,
  combineReactions,
  commentReaction,
} from '../lib/audience-comments/reaction';

/**
 * FILM-1733. What the page and the MCP tools read about audience comments,
 * and the one way a label is written by a person's AI. Every read runs on
 * the caller's own client, so RLS decides whose comments are seen.
 */

type Client = SupabaseClient<Database>;

export type CommentScope =
  | { projectId: string }
  | { episodeId: string }
  | { publishIds: string[] };

export interface ScopedPublish {
  id: string;
  episode_id: string;
  platform: string;
  content_type: string;
  title: string | null;
  platform_url: string | null;
  published_at: string | null;
  episodeTitle: string | null;
}

/** YouTube's rule for a figure we calculate from its data (Developer Policies III.E.4.h) */
export const NOT_FROM_YOUTUBE =
  'Calculated by StoryBook from the comments, not from YouTube.';

export async function publishesInScope(
  client: Client,
  scope: CommentScope,
): Promise<ScopedPublish[]> {
  const columns =
    'id, episode_id, platform, content_type, title, platform_url, published_at, status, episodes!inner(title, project_id)';

  type Row = Omit<ScopedPublish, 'episodeTitle'> & {
    status: string;
    episodes: { title: string | null; project_id: string };
  };

  const rows =
    'publishIds' in scope
      ? await fetchAllByIds<Row>(
          scope.publishIds,
          (chunk, from, to) =>
            client
              .from('publishes')
              .select(columns)
              .in('id', chunk)
              .order('id')
              .range(from, to),
          'scoped publishes',
        )
      : await fetchAllRows<Row>((from, to) => {
          const query = client.from('publishes').select(columns);
          const scoped =
            'projectId' in scope
              ? query.eq('episodes.project_id', scope.projectId)
              : query.eq('episode_id', scope.episodeId);

          return scoped.order('id').range(from, to);
        }, 'scoped publishes');

  return rows
    .filter((row) => row.status === 'published' || row.status === 'unlisted')
    .map(({ episodes, status: _status, ...row }) => ({
      ...row,
      episodeTitle: episodes.title,
    }));
}

export interface StoredComment {
  id: string;
  publish_id: string;
  platform: string;
  text: string;
  like_count: number;
  /** Null: the platform does not report it */
  reply_count: number | null;
  commented_at: string;
  parent_platform_comment_id: string | null;
  /** At most one: comment_id is the label's key. Null under an anti-join */
  comment_labels: null | Array<{
    sentiment: string;
    topics: string[];
    source: string;
    model: string;
  }>;
}

export interface CommentLabelView {
  sentiment: CommentSentiment;
  topics: CommentTopic[];
  source: string;
  model: string;
}

/** A stored comment's label, read through the closed lists */
export function labelOf(comment: Pick<StoredComment, 'comment_labels'>) {
  const label = comment.comment_labels?.[0];
  if (!label || !isSentiment(label.sentiment)) return null;

  return {
    sentiment: label.sentiment,
    topics: label.topics.filter(isTopic),
    source: label.source,
    model: label.model,
  } satisfies CommentLabelView;
}

function isSentiment(value: string): value is CommentSentiment {
  return (COMMENT_SENTIMENTS as readonly string[]).includes(value);
}

function isTopic(value: string): value is CommentTopic {
  return (COMMENT_TOPICS as readonly string[]).includes(value);
}

const SYNC_STATES: readonly CommentSyncState[] = [
  'ok',
  'never',
  'failed',
  'not_authorised',
  'unsupported',
];

function syncState(value: string): CommentSyncState {
  return (SYNC_STATES as readonly string[]).includes(value)
    ? (value as CommentSyncState)
    : 'never';
}

const COMMENT_COLUMNS =
  'id, publish_id, platform, text, like_count, reply_count, commented_at, parent_platform_comment_id, comment_labels(sentiment, topics, source, model)';

async function commentsOf(client: Client, publishIds: string[]) {
  return fetchAllByIds<StoredComment>(
    publishIds,
    (chunk, from, to) =>
      client
        .from('audience_comments')
        .select(COMMENT_COLUMNS)
        .in('publish_id', chunk)
        .order('id')
        .range(from, to),
    'audience comments',
  );
}

export interface VideoReaction {
  publish: ScopedPublish;
  reaction: CommentReaction;
  /** A YouTube figure carries NOT_FROM_YOUTUBE wherever it is shown */
  disclosure: string | null;
}

export type CommentReactions = Awaited<ReturnType<typeof getCommentReactions>>;

export async function getCommentReactions(client: Client, scope: CommentScope) {
  const publishes = await publishesInScope(client, scope);
  const ids = publishes.map((p) => p.id);

  const [comments, syncs] = await Promise.all([
    commentsOf(client, ids),
    fetchAllByIds<{ publish_id: string; last_status: string }>(
      ids,
      (chunk, from, to) =>
        client
          .from('audience_comment_syncs')
          .select('publish_id, last_status')
          .in('publish_id', chunk)
          .order('publish_id')
          .range(from, to),
      'comment syncs',
    ),
  ]);

  const syncOf = new Map(
    syncs.map((s) => [s.publish_id, syncState(s.last_status)]),
  );
  const byPublish = new Map<string, StoredComment[]>();
  for (const comment of comments) {
    byPublish.set(comment.publish_id, [
      ...(byPublish.get(comment.publish_id) ?? []),
      comment,
    ]);
  }

  const videos: VideoReaction[] = publishes.map((publish) => ({
    publish,
    reaction: commentReaction({
      platform: publish.platform,
      publishedAt: publish.published_at,
      sync: syncOf.get(publish.id) ?? null,
      comments: (byPublish.get(publish.id) ?? []).map((c) => ({
        commentedAt: c.commented_at,
        label: labelOf(c),
      })),
    }),
    disclosure: publish.platform === 'youtube' ? NOT_FROM_YOUTUBE : null,
  }));

  return {
    videos,
    combined: combineReactions(videos.map((v) => v.reaction)),
    disclosure: videos.some((v) => v.publish.platform === 'youtube')
      ? NOT_FROM_YOUTUBE
      : null,
  };
}

export interface CommentListFilter {
  sentiment?: CommentSentiment;
  topic?: CommentTopic;
  /** Only comments no one has labelled yet */
  unlabelled?: boolean;
  limit: number;
  /** The last comment of the previous page */
  after?: { commentedAt: string; id: string };
}

const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Comments in a scope, newest first, with their labels. The scope is a join
 * filter, not a list of ids, so a project of any size is read whole.
 */
export async function listAudienceComments(
  client: Client,
  scope: CommentScope,
  filter: CommentListFilter,
) {
  const labelJoin =
    filter.sentiment || filter.topic
      ? 'comment_labels!inner(sentiment, topics, source, model)'
      : 'comment_labels(sentiment, topics, source, model)';

  let query = client
    .from('audience_comments')
    .select(
      `id, publish_id, platform, text, like_count, reply_count, commented_at, parent_platform_comment_id, ${labelJoin}, publishes!inner(episode_id, title, content_type, episodes!inner(project_id, title))`,
    );

  if ('projectId' in scope) {
    query = query.eq('publishes.episodes.project_id', scope.projectId);
  } else if ('episodeId' in scope) {
    query = query.eq('publishes.episode_id', scope.episodeId);
  } else {
    query = query.in('publish_id', scope.publishIds);
  }

  if (filter.sentiment) {
    query = query.eq('comment_labels.sentiment', filter.sentiment);
  }
  if (filter.topic) {
    query = query.contains('comment_labels.topics', [filter.topic]);
  }
  if (filter.unlabelled) query = query.is('comment_labels', null);
  // Newest first, ties by id: the page goes on strictly after the last one
  if (filter.after) {
    // Both go into a filter string: only a timestamp and a uuid may
    if (
      !TIMESTAMP.test(filter.after.commentedAt) ||
      !UUID.test(filter.after.id)
    ) {
      throw new Error('The page cursor is not one this list gave');
    }

    const at = `"${filter.after.commentedAt}"`;
    query = query.or(
      `commented_at.lt.${at},and(commented_at.eq.${at},id.gt.${filter.after.id})`,
    );
  }

  const { data, error } = await query
    .order('commented_at', { ascending: false })
    .order('id')
    .limit(filter.limit);

  if (error) throw new Error(`Could not read comments: ${error.message}`);

  const comments = (data ?? []) as unknown as Array<
    StoredComment & {
      publishes: {
        episode_id: string;
        title: string | null;
        content_type: string;
        episodes: { project_id: string; title: string | null };
      };
    }
  >;

  const last = comments[comments.length - 1];

  return {
    comments,
    next:
      last && comments.length === filter.limit
        ? { commentedAt: last.commented_at, id: last.id }
        : null,
  };
}

export type LabelWriteResult = {
  written: number;
  /** Ids that are not this team's comments, or do not exist */
  refused: string[];
};

/**
 * Writes labels a person's AI made, as theirs (source 'mcp'). Only the
 * team's own comments are written: an id from elsewhere is refused by name,
 * and RLS and the comment's account key refuse it again.
 */
export async function writeCommentLabels(
  client: Client,
  input: {
    accountId: string;
    batch: CommentLabelBatch;
    mcpConnectionId: string | null;
  },
): Promise<LabelWriteResult> {
  const ids = [...new Set(input.batch.labels.map((l) => l.commentId))];

  const owned = await fetchAllByIds<{ id: string }>(
    ids,
    (chunk, from, to) =>
      client
        .from('audience_comments')
        .select('id')
        .eq('account_id', input.accountId)
        .in('id', chunk)
        .order('id')
        .range(from, to),
    'labelled comments',
  );

  const ownedIds = new Set(owned.map((row) => row.id));
  // A comment named twice in one write keeps its first label
  const firsts = input.batch.labels.filter(
    (label, index) =>
      ownedIds.has(label.commentId) &&
      input.batch.labels.findIndex((l) => l.commentId === label.commentId) ===
        index,
  );
  const rows = firsts.map((label) => ({
    comment_id: label.commentId,
    account_id: input.accountId,
    sentiment: label.sentiment,
    topics: label.topics,
    source: 'mcp' as const,
    model: input.batch.model,
    prompt_version: input.batch.promptVersion,
    mcp_connection_id: input.mcpConnectionId,
    labelled_at: new Date().toISOString(),
  }));

  if (rows.length) {
    const { error } = await client
      .from('comment_labels')
      .upsert(rows, { onConflict: 'comment_id' });

    if (error) throw new Error(`Could not write labels: ${error.message}`);
  }

  return {
    written: rows.length,
    refused: ids.filter((id) => !ownedIds.has(id)),
  };
}
