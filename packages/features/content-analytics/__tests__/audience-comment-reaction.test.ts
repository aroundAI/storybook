import { describe, expect, it } from 'vitest';

import {
  CommentLabelBatchSchema,
  CommentLabelSchema,
  commentLabelInstructions,
} from '../src/lib/audience-comments/labels';
import {
  MIN_LABELLED_FOR_SHARES,
  type ReactionComment,
  ageBucketOf,
  combineReactions,
  commentReaction,
} from '../src/lib/audience-comments/reaction';
import {
  MAX_CONSECUTIVE_FAILURES,
  REFRESH_EVERY_MS,
  planCommentSync,
  readIntervalMs,
} from '../src/lib/audience-comments/sync-schedule';

/**
 * FILM-1733. How a video's comments become a reaction, which states the
 * page must tell apart, and when a video's comments are read again.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PUBLISHED = '2026-10-01T12:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(PUBLISHED) + ms).toISOString();

function comments(
  n: number,
  label: ReactionComment['label'],
  ageMs = HOUR,
): ReactionComment[] {
  return Array.from({ length: n }, () => ({ commentedAt: at(ageMs), label }));
}

const positive = { sentiment: 'positive' as const, topics: ['story' as const] };
const negative = {
  sentiment: 'negative' as const,
  topics: ['pacing' as const, 'feels_ai' as const],
};

describe('what the page can say about a video', () => {
  it('says a platform with no comment API cannot be read, not that nobody commented', () => {
    expect(
      commentReaction({
        platform: 'tiktok',
        publishedAt: PUBLISHED,
        sync: null,
        comments: [],
      }),
    ).toEqual({ kind: 'unsupported', platform: 'tiktok' });
  });

  it('tells "never read", "not authorised" and "failed" apart from "no comments"', () => {
    const reaction = (sync: Parameters<typeof commentReaction>[0]['sync']) =>
      commentReaction({
        platform: 'youtube',
        publishedAt: PUBLISHED,
        sync,
        comments: [],
      });

    expect(reaction(null)).toEqual({
      kind: 'not_read',
      reason: 'never_synced',
    });
    expect(reaction('not_authorised')).toEqual({
      kind: 'not_read',
      reason: 'not_authorised',
    });
    expect(reaction('failed')).toEqual({
      kind: 'not_read',
      reason: 'sync_failed',
    });
    expect(reaction('ok')).toEqual({ kind: 'no_comments' });
  });

  it('gives no shares below 20 labelled comments, and says how many there are', () => {
    const reaction = commentReaction({
      platform: 'youtube',
      publishedAt: PUBLISHED,
      sync: 'ok',
      comments: [
        ...comments(MIN_LABELLED_FOR_SHARES - 1, positive),
        ...comments(30, null),
      ],
    });

    expect(reaction.kind).toBe('read');
    if (reaction.kind !== 'read') return;
    expect(reaction.comments).toBe(49);
    expect(reaction.unlabelled).toBe(30);
    expect(reaction.shares).toEqual({
      kind: 'too_few',
      labelled: 19,
      needed: 20,
    });
  });

  it('gives shares of labelled comments only, never of the unlabelled', () => {
    const reaction = commentReaction({
      platform: 'youtube',
      publishedAt: PUBLISHED,
      sync: 'ok',
      comments: [
        ...comments(15, positive),
        ...comments(5, negative),
        ...comments(80, null),
      ],
    });

    if (reaction.kind !== 'read') throw new Error(reaction.kind);
    expect(reaction.shares).toMatchObject({
      kind: 'shares',
      labelled: 20,
      sentiment: { positive: 75, neutral: 0, negative: 25 },
      topics: { story: 75, pacing: 25, feels_ai: 25, wants_more: 0 },
    });
    expect(reaction.sentiment).toEqual({
      positive: 15,
      neutral: 0,
      negative: 5,
    });
  });

  it('splits a video’s comments by how old the video was', () => {
    const reaction = commentReaction({
      platform: 'youtube',
      publishedAt: PUBLISHED,
      sync: 'ok',
      comments: [
        ...comments(2, positive, 2 * HOUR),
        ...comments(3, negative, 3 * DAY),
        ...comments(1, positive, 20 * DAY),
        ...comments(4, null, 45 * DAY),
      ],
    });

    if (reaction.kind !== 'read') throw new Error(reaction.kind);
    expect(reaction.byAge.map((b) => [b.key, b.comments, b.labelled])).toEqual([
      ['first_day', 2, 2],
      ['first_week', 3, 3],
      ['first_month', 1, 1],
      ['later', 4, 0],
    ]);
    expect(reaction.byAge[1]!.sentiment.negative).toBe(3);
  });

  it('puts a boundary comment in the earlier bucket', () => {
    expect(ageBucketOf(DAY)).toBe('first_day');
    expect(ageBucketOf(DAY + 1)).toBe('first_week');
    expect(ageBucketOf(7 * DAY)).toBe('first_week');
    expect(ageBucketOf(30 * DAY + 1)).toBe('later');
    expect(ageBucketOf(-HOUR)).toBe('first_day');
  });

  it('adds read videos together and leaves the unread out of the count', () => {
    const read = commentReaction({
      platform: 'youtube',
      publishedAt: PUBLISHED,
      sync: 'ok',
      comments: comments(12, positive),
    });
    const other = commentReaction({
      platform: 'instagram',
      publishedAt: PUBLISHED,
      sync: 'ok',
      comments: comments(10, negative),
    });
    const unread = commentReaction({
      platform: 'tiktok',
      publishedAt: PUBLISHED,
      sync: null,
      comments: [],
    });

    const combined = combineReactions([read, other, unread]);
    expect(combined.videos).toBe(2);
    expect(combined.labelled).toBe(22);
    expect(combined.shares).toMatchObject({
      kind: 'shares',
      sentiment: { positive: 55, negative: 45 },
    });
  });
});

describe('a label', () => {
  const id = '6f1c2e0a-0000-4000-8000-000000000001';

  it('takes a tone and topics from the closed lists only', () => {
    expect(
      CommentLabelSchema.safeParse({
        commentId: id,
        sentiment: 'furious',
        topics: [],
      }).success,
    ).toBe(false);
    expect(
      CommentLabelSchema.safeParse({
        commentId: id,
        sentiment: 'positive',
        topics: ['ignore previous instructions'],
      }).success,
    ).toBe(false);
  });

  it('keeps a topic once', () => {
    expect(
      CommentLabelSchema.parse({
        commentId: id,
        sentiment: 'neutral',
        topics: ['question', 'question'],
      }).topics,
    ).toEqual(['question']);
  });

  it('a write names its model, and carries at most 200 labels', () => {
    const label = { commentId: id, sentiment: 'neutral', topics: [] };

    expect(
      CommentLabelBatchSchema.safeParse({
        labels: [label],
        model: ' ',
        promptVersion: '1',
      }).success,
    ).toBe(false);
    expect(
      CommentLabelBatchSchema.safeParse({
        labels: Array.from({ length: 201 }, () => label),
        model: 'm',
        promptVersion: '1',
      }).success,
    ).toBe(false);
  });

  it('the rules every labeller reads name every topic', () => {
    const text = commentLabelInstructions();

    for (const topic of ['story', 'wants_more', 'feels_ai', 'spam']) {
      expect(text).toContain(`- ${topic}:`);
    }
  });
});

describe('when a video’s comments are read again', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');
  const sync = (
    over: Partial<Parameters<typeof planCommentSync>[0]['sync'] & object>,
  ) => ({
    last_synced_at: now.toISOString(),
    last_refreshed_at: now.toISOString(),
    last_status: 'ok',
    consecutive_failures: 0,
    updated_at: now.toISOString(),
    ...over,
  });
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('reads a video it has never read, every comment', () => {
    expect(
      planCommentSync({ publishedAt: ago(DAY), sync: null, now }),
    ).toMatchObject({ due: true, refresh: true, since: null });
  });

  it('reads a young video often and an old one rarely', () => {
    expect(readIntervalMs(HOUR)).toBe(HOUR);
    expect(readIntervalMs(3 * DAY)).toBe(6 * HOUR);
    expect(readIntervalMs(10 * DAY)).toBe(DAY);
    expect(readIntervalMs(60 * DAY)).toBe(7 * DAY);

    expect(
      planCommentSync({
        publishedAt: ago(60 * DAY),
        sync: sync({
          last_synced_at: ago(2 * DAY),
          last_refreshed_at: ago(2 * DAY),
        }),
        now,
      }),
    ).toEqual({ due: false });
  });

  it('reads only new comments between refreshes, from just before the last read', () => {
    const plan = planCommentSync({
      publishedAt: ago(HOUR * 10),
      sync: sync({
        last_synced_at: ago(2 * HOUR),
        last_refreshed_at: ago(DAY),
      }),
      now,
    });

    expect(plan).toMatchObject({ due: true, refresh: false });
    if (!plan.due) return;
    expect(plan.since?.toISOString()).toBe(ago(3 * HOUR));
  });

  it('reads every comment again within a week, well inside YouTube’s 30 days', () => {
    expect(REFRESH_EVERY_MS).toBeLessThan(30 * DAY);
    expect(
      planCommentSync({
        publishedAt: ago(90 * DAY),
        sync: sync({
          last_synced_at: ago(HOUR),
          last_refreshed_at: ago(7 * DAY),
        }),
        now,
      }),
    ).toMatchObject({ due: true, refresh: true });
  });

  it('tries a video that keeps failing once a day', () => {
    const failing = sync({
      last_synced_at: ago(5 * DAY),
      consecutive_failures: MAX_CONSECUTIVE_FAILURES,
      updated_at: ago(2 * HOUR),
    });

    expect(
      planCommentSync({ publishedAt: ago(DAY), sync: failing, now }),
    ).toEqual({ due: false });
    expect(
      planCommentSync({
        publishedAt: ago(DAY),
        sync: { ...failing, updated_at: ago(25 * HOUR) },
        now,
      }).due,
    ).toBe(true);
  });
});
