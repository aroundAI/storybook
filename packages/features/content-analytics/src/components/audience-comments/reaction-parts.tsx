'use client';

import {
  COMMENT_TOPICS,
  COMMENT_TOPIC_LABELS,
  type CommentSentiment,
} from '../../lib/audience-comments/labels';
import type {
  CommentReaction,
  SentimentCounts,
  Shares,
  TopicCounts,
} from '../../lib/audience-comments/reaction';
import { platformLabel } from '../../lib/platform-labels';

/**
 * FILM-1733. The small pieces the audience-reaction section is drawn with.
 * Tone is a polarity, so it is a diverging bar: negative (warm) through a
 * neutral grey to positive (cool), from the theme's validated chart ramp.
 * Every segment's share is printed beside it, so identity is never colour
 * alone and the grey's low contrast is relieved.
 */

export const SENTIMENT_ORDER: readonly CommentSentiment[] = [
  'negative',
  'neutral',
  'positive',
];

const SENTIMENT_FILL: Record<CommentSentiment, string> = {
  negative: 'var(--chart-7)',
  neutral: 'var(--chart-neutral-soft)',
  positive: 'var(--chart-1)',
};

export const SENTIMENT_LABEL: Record<CommentSentiment, string> = {
  negative: 'Negative',
  neutral: 'Neutral',
  positive: 'Positive',
};

export function SentimentSwatch({
  sentiment,
}: {
  sentiment: CommentSentiment;
}) {
  return (
    <span
      aria-hidden
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
      style={{ background: SENTIMENT_FILL[sentiment] }}
    />
  );
}

/** The tone split as a bar, its shares as text; or why there are none */
export function SentimentBar({
  shares,
  dataTest,
}: {
  shares: Shares;
  dataTest?: string;
}) {
  if (shares.kind === 'too_few') {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-test={dataTest ? `${dataTest}-too-few` : undefined}
      >
        Too few labelled comments to give shares ({shares.labelled} of{' '}
        {shares.needed})
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1" data-test={dataTest}>
      <div
        className="flex h-2 w-full gap-[2px] overflow-hidden"
        role="img"
        aria-label={SENTIMENT_ORDER.map(
          (s) => `${SENTIMENT_LABEL[s]} ${shares.sentiment[s]}%`,
        ).join(', ')}
      >
        {SENTIMENT_ORDER.filter((s) => shares.sentiment[s] > 0).map(
          (sentiment, index, shown) => (
            <span
              key={sentiment}
              title={`${SENTIMENT_LABEL[sentiment]}: ${shares.sentiment[sentiment]}% of ${shares.labelled}`}
              className={
                index === 0
                  ? 'rounded-l'
                  : index === shown.length - 1
                    ? 'rounded-r'
                    : ''
              }
              style={{
                width: `${shares.sentiment[sentiment]}%`,
                background: SENTIMENT_FILL[sentiment],
              }}
            />
          ),
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {SENTIMENT_ORDER.map((sentiment) => (
          <span
            key={sentiment}
            className="inline-flex items-center gap-1"
            data-test={dataTest ? `${dataTest}-${sentiment}` : undefined}
          >
            <SentimentSwatch sentiment={sentiment} />
            {SENTIMENT_LABEL[sentiment]} {shares.sentiment[sentiment]}%
          </span>
        ))}
      </div>
    </div>
  );
}

/** The topics most comments are about, largest first, as counts and shares */
export function TopTopics({
  topics,
  labelled,
  limit = 3,
}: {
  topics: TopicCounts;
  labelled: number;
  limit?: number;
}) {
  const ranked = COMMENT_TOPICS.filter((t) => topics[t] > 0)
    .sort((a, b) => topics[b] - topics[a])
    .slice(0, limit);

  if (ranked.length === 0) {
    return <span className="text-xs text-muted-foreground">No topic yet</span>;
  }

  return (
    <span className="text-xs">
      {ranked
        .map(
          (topic) =>
            `${COMMENT_TOPIC_LABELS[topic]} ${topics[topic]}${
              labelled > 0
                ? ` (${Math.round((topics[topic] / labelled) * 100)}%)`
                : ''
            }`,
        )
        .join(' · ')}
    </span>
  );
}

/** What a video's reaction is, in words, when it is not read */
export function reactionStateText(reaction: CommentReaction): string | null {
  switch (reaction.kind) {
    case 'unsupported':
      return `${platformLabel(reaction.platform)} has no way to read comments`;
    case 'not_read':
      return reaction.reason === 'never_synced'
        ? 'Not read yet: comments are read hourly'
        : reaction.reason === 'not_authorised'
          ? 'Not read: the channel has not granted comment access'
          : 'Not read: the last comment sync failed';
    case 'no_comments':
      return 'No comments yet';
    case 'read':
      return null;
  }
}

export function sentimentTotal(counts: SentimentCounts) {
  return counts.negative + counts.neutral + counts.positive;
}
