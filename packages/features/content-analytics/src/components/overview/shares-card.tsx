'use client';

import { Share2 } from 'lucide-react';

import { formatNumber } from '../../lib/format';
import { AnalyticsCard } from './analytics-card';

interface SharesCardProps {
  /** Total shares */
  shares: number;
}

/**
 * Shares, and only shares. This card drew a donut of "Direct" against
 * "Copy Link" that was 83/17 for every account — a default typed in from
 * the prototype, with nothing upstream that could have overridden it. No
 * platform read we ingest says how a share happened, so the card says so
 * instead of drawing one (KB-16).
 */
export function SharesCard({ shares }: SharesCardProps) {
  return (
    <AnalyticsCard
      title="Shares"
      icon={Share2}
      description="Times content was shared or reposted"
      data-test="overview-shares"
    >
      <div
        className="text-5xl font-extrabold tracking-tight text-gray-900 dark:text-white"
        data-test="overview-shares-total"
      >
        {formatNumber(shares)}
      </div>
      <p
        className="mt-3 text-xs text-gray-500 dark:text-gray-400"
        data-test="overview-shares-not-collected"
      >
        We don&rsquo;t collect how content was shared, only how often.
      </p>
    </AnalyticsCard>
  );
}
