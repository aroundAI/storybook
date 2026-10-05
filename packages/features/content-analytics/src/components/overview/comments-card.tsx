'use client';

import { MessageCircle } from 'lucide-react';

import { formatNumber } from '../../lib/format';
import type { Measured } from '../../lib/measured';
import { AnalyticsCard } from './analytics-card';
import { countClaim } from './card-claim';

interface CommentsCardProps {
  /** Total comments: absent when they could not be read, null when not measured. */
  comments: Measured<number | null>;
  /**
   * The one item with strictly the most comments, from `mostDiscussed`,
   * or null when nothing qualifies — nobody commented, or two items tie.
   */
  mostDiscussed: { title: string; comments: number } | null;
}

export function CommentsCard({ comments, mostDiscussed }: CommentsCardProps) {
  const sentence = mostDiscussed
    ? `“${mostDiscussed.title}” drew ${formatNumber(mostDiscussed.comments)} of these.`
    : 'Comments and replies in the selected period.';

  return (
    <AnalyticsCard
      title="Comments"
      icon={MessageCircle}
      metricFamily="engagement"
      claim={countClaim(comments, sentence)}
      data-test="overview-comments"
    />
  );
}
