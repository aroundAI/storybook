import {
  COMMENT_SENTIMENTS,
  COMMENT_TOPICS,
  type CommentSentiment,
  type CommentTopic,
} from './labels';

/**
 * FILM-1733. How a video's audience reacted, from its labelled comments,
 * and how that changed with the video's age.
 *
 * Each state the page must tell apart is its own case (analytics standard:
 * "cannot measure" never looks like "measured badly"): a platform whose
 * comments cannot be read, a video whose comments were not read, a video
 * with no comments, too few labelled to give shares, and shares. Shares
 * are of labelled comments; counts carry their n.
 *
 * Pure: the service reads the rows and passes them in.
 */

/** Below this many labelled comments a share says more about chance than the audience */
export const MIN_LABELLED_FOR_SHARES = 20;

/** Platforms whose comment text can be read through an official API */
export const COMMENT_PLATFORMS = ['youtube', 'instagram', 'facebook'] as const;

export type CommentPlatform = (typeof COMMENT_PLATFORMS)[number];

export function isCommentPlatform(
  platform: string,
): platform is CommentPlatform {
  return (COMMENT_PLATFORMS as readonly string[]).includes(platform);
}

export type CommentSyncState =
  | 'ok'
  | 'never'
  | 'failed'
  | 'not_authorised'
  | 'unsupported';

export interface ReactionComment {
  commentedAt: string;
  label: {
    sentiment: CommentSentiment;
    topics: readonly CommentTopic[];
  } | null;
}

export interface ReactionInput {
  platform: string;
  publishedAt: string | null;
  /** The video's comment sync, or null when it never ran */
  sync: CommentSyncState | null;
  comments: readonly ReactionComment[];
}

export const AGE_BUCKETS = [
  { key: 'first_day', label: 'First day', untilDays: 1 },
  { key: 'first_week', label: 'Days 2–7', untilDays: 7 },
  { key: 'first_month', label: 'Days 8–30', untilDays: 30 },
  { key: 'later', label: 'After 30 days', untilDays: Infinity },
] as const;

export type AgeBucketKey = (typeof AGE_BUCKETS)[number]['key'];

export type SentimentCounts = Record<CommentSentiment, number>;
export type TopicCounts = Record<CommentTopic, number>;

export type Shares =
  | { kind: 'too_few'; labelled: number; needed: number }
  | {
      kind: 'shares';
      labelled: number;
      sentiment: SentimentCounts;
      topics: TopicCounts;
    };

export interface AgeBucketReaction {
  key: AgeBucketKey;
  label: string;
  comments: number;
  labelled: number;
  sentiment: SentimentCounts;
  shares: Shares;
}

export interface ReactionCounts {
  comments: number;
  labelled: number;
  sentiment: SentimentCounts;
  topics: TopicCounts;
}

export type CommentReaction =
  | { kind: 'unsupported'; platform: string }
  | {
      kind: 'not_read';
      reason: 'never_synced' | 'not_authorised' | 'sync_failed';
    }
  | { kind: 'no_comments' }
  | ({
      kind: 'read';
      unlabelled: number;
      shares: Shares;
      byAge: AgeBucketReaction[];
    } & ReactionCounts);

const DAY_MS = 86_400_000;

export function emptySentiment(): SentimentCounts {
  return Object.fromEntries(
    COMMENT_SENTIMENTS.map((s) => [s, 0]),
  ) as SentimentCounts;
}

export function emptyTopics(): TopicCounts {
  return Object.fromEntries(COMMENT_TOPICS.map((t) => [t, 0])) as TopicCounts;
}

/** Shares, as whole percentages of the labelled comments, or why there are none */
export function sharesOf(counts: {
  labelled: number;
  sentiment: SentimentCounts;
  topics: TopicCounts;
}): Shares {
  if (counts.labelled < MIN_LABELLED_FOR_SHARES) {
    return {
      kind: 'too_few',
      labelled: counts.labelled,
      needed: MIN_LABELLED_FOR_SHARES,
    };
  }

  const pct = (n: number) => Math.round((n / counts.labelled) * 100);

  return {
    kind: 'shares',
    labelled: counts.labelled,
    sentiment: Object.fromEntries(
      COMMENT_SENTIMENTS.map((s) => [s, pct(counts.sentiment[s])]),
    ) as SentimentCounts,
    topics: Object.fromEntries(
      COMMENT_TOPICS.map((t) => [t, pct(counts.topics[t])]),
    ) as TopicCounts,
  };
}

/** Which age bucket a comment made `ageMs` after the video went out falls in */
export function ageBucketOf(ageMs: number): AgeBucketKey {
  const days = Math.max(0, ageMs) / DAY_MS;

  return AGE_BUCKETS.find((bucket) => days <= bucket.untilDays)!.key;
}

export function countComments(
  comments: readonly ReactionComment[],
): ReactionCounts {
  const counts: ReactionCounts = {
    comments: comments.length,
    labelled: 0,
    sentiment: emptySentiment(),
    topics: emptyTopics(),
  };

  for (const comment of comments) {
    if (!comment.label) continue;
    counts.labelled++;
    counts.sentiment[comment.label.sentiment]++;
    for (const topic of comment.label.topics) counts.topics[topic]++;
  }

  return counts;
}

export function commentReaction(input: ReactionInput): CommentReaction {
  if (!isCommentPlatform(input.platform) || input.sync === 'unsupported') {
    return { kind: 'unsupported', platform: input.platform };
  }

  if (input.comments.length === 0) {
    if (input.sync === null || input.sync === 'never') {
      return { kind: 'not_read', reason: 'never_synced' };
    }
    if (input.sync === 'not_authorised') {
      return { kind: 'not_read', reason: 'not_authorised' };
    }
    if (input.sync === 'failed') {
      return { kind: 'not_read', reason: 'sync_failed' };
    }

    return { kind: 'no_comments' };
  }

  const counts = countComments(input.comments);
  const published = input.publishedAt
    ? new Date(input.publishedAt).getTime()
    : null;

  const byAge = AGE_BUCKETS.map((bucket) => {
    const inBucket =
      published === null
        ? []
        : input.comments.filter(
            (c) =>
              ageBucketOf(new Date(c.commentedAt).getTime() - published) ===
              bucket.key,
          );
    const bucketCounts = countComments(inBucket);

    return {
      key: bucket.key,
      label: bucket.label,
      comments: bucketCounts.comments,
      labelled: bucketCounts.labelled,
      sentiment: bucketCounts.sentiment,
      shares: sharesOf(bucketCounts),
    };
  });

  return {
    kind: 'read',
    ...counts,
    unlabelled: counts.comments - counts.labelled,
    shares: sharesOf(counts),
    byAge,
  };
}

/** Several videos' read reactions added together: a channel, a project, an episode */
export function combineReactions(
  reactions: readonly CommentReaction[],
): ReactionCounts & { videos: number; shares: Shares } {
  const total: ReactionCounts = {
    comments: 0,
    labelled: 0,
    sentiment: emptySentiment(),
    topics: emptyTopics(),
  };
  let videos = 0;

  for (const reaction of reactions) {
    if (reaction.kind !== 'read') continue;
    videos++;
    total.comments += reaction.comments;
    total.labelled += reaction.labelled;
    for (const s of COMMENT_SENTIMENTS)
      total.sentiment[s] += reaction.sentiment[s];
    for (const t of COMMENT_TOPICS) total.topics[t] += reaction.topics[t];
  }

  return { ...total, videos, shares: sharesOf(total) };
}
