'use client';

import { ArrowUp, MessageCircle } from 'lucide-react';

import { formatNumber, formatPercent } from '../../lib/format';
import { AnalyticsCard } from './analytics-card';

interface CommentsCardProps {
  /** Total comments */
  comments: number;
  /** Percentage change */
  change?: number;
  /** Top commented content title */
  topCommentedTitle?: string;
}

export function CommentsCard({
  comments,
  change,
  topCommentedTitle,
}: CommentsCardProps) {
  return (
    <AnalyticsCard
      title="Comments"
      icon={MessageCircle}
      description="Total comments and replies"
      footer="High community interaction"
    >
      <div className="text-5xl font-extrabold tracking-tight text-gray-900 dark:text-white">
        {formatNumber(comments)}
      </div>
      {change !== undefined && change !== 0 && (
        <div className="mb-4 flex items-center text-sm font-semibold text-green-700 dark:text-green-400">
          <ArrowUp className="mr-1 h-4 w-4" />
          {formatPercent(Math.abs(change))}
        </div>
      )}
      {topCommentedTitle && (
        <div className="mt-2 text-sm leading-tight text-gray-900 dark:text-gray-100">
          &ldquo;<span className="font-semibold">{topCommentedTitle}</span>
          &rdquo; generated the most discussion.
        </div>
      )}
    </AnalyticsCard>
  );
}
