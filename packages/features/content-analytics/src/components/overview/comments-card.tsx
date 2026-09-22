'use client';

import { MessageCircle } from 'lucide-react';

import { formatNumber } from '../../lib/format';
import { AnalyticsCard } from './analytics-card';

interface CommentsCardProps {
  /** Total comments */
  comments: number;
  /**
   * The one item with strictly the most comments, from `mostDiscussed`,
   * or null when nothing qualifies — nobody commented, or two items tie.
   */
  mostDiscussed: { title: string; comments: number } | null;
}

export function CommentsCard({ comments, mostDiscussed }: CommentsCardProps) {
  return (
    <AnalyticsCard
      title="Comments"
      icon={MessageCircle}
      description="Total comments and replies"
      footer="Aggregated across all platforms"
      data-test="overview-comments"
    >
      <div className="text-5xl font-extrabold tracking-tight text-gray-900 dark:text-white">
        {formatNumber(comments)}
      </div>
      {mostDiscussed && (
        <div
          className="mt-2 text-sm leading-tight text-gray-900 dark:text-gray-100"
          data-test="overview-comments-most-discussed"
        >
          &ldquo;<span className="font-semibold">{mostDiscussed.title}</span>
          &rdquo; drew {formatNumber(mostDiscussed.comments)} of these.
        </div>
      )}
    </AnalyticsCard>
  );
}
