'use client';

import { MessageCircle } from 'lucide-react';

import type { AnalyticsPlatform } from '@kit/clickhouse';

import { formatNumber } from '../../lib/format';
import { AnalyticsCard } from './analytics-card';
import { countClaim } from './card-claim';

interface CommentsCardProps {
  /** The platforms the figure covers, for "where this comes from". */
  platforms?: readonly AnalyticsPlatform[];
  /** Total comments, or `null` when they could not be read. */
  comments: number | null;
  /**
   * The one item with strictly the most comments, from `mostDiscussed`,
   * or null when nothing qualifies — nobody commented, or two items tie.
   */
  mostDiscussed: { title: string; comments: number } | null;
}

export function CommentsCard({
  comments,
  mostDiscussed,
  platforms,
}: CommentsCardProps) {
  const sentence = mostDiscussed
    ? `“${mostDiscussed.title}” drew ${formatNumber(mostDiscussed.comments)} of these.`
    : 'Comments and replies in the selected period.';

  return (
    <AnalyticsCard
      title="Comments"
      icon={MessageCircle}
      metricFamily="engagement"
      platforms={platforms}
      claim={countClaim(comments, sentence)}
      data-test="overview-comments"
    />
  );
}
