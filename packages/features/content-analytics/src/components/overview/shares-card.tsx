'use client';

import { Share2 } from 'lucide-react';

import { formatNumber } from '../../lib/format';
import { DonutChart } from '../charts/donut-chart';
import { AnalyticsCard } from './analytics-card';

interface ShareBreakdown {
  direct: number;
  copyLink: number;
}

interface SharesCardProps {
  /** Total shares */
  shares: number;
  /** Share breakdown (direct vs copy link) */
  breakdown?: ShareBreakdown;
}

export function SharesCard({ shares, breakdown }: SharesCardProps) {
  // Default breakdown if not provided (83% direct, 17% copy link from prototype)
  const shareBreakdown = breakdown || { direct: 83, copyLink: 17 };

  return (
    <AnalyticsCard
      title="Shares"
      icon={Share2}
      description="Times content was shared or reposted"
      footer="Viral coefficient is rising"
    >
      <div className="text-5xl font-extrabold tracking-tight text-gray-900 dark:text-white">
        {formatNumber(shares)}
      </div>
      <div className="mt-2 flex items-center gap-4">
        <DonutChart
          segments={[
            {
              value: shareBreakdown.direct,
              color: 'var(--analytics-blue)',
              label: 'Direct',
            },
            {
              value: shareBreakdown.copyLink,
              color: 'var(--analytics-donut-secondary)',
              label: 'Copy Link',
            },
          ]}
          size={64}
          thickness={8}
        />
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
          <div className="mb-1 flex items-center">
            <div className="mr-1.5 h-2 w-2 rounded-full bg-blue-500 dark:bg-blue-400" />
            Direct
          </div>
          <div className="flex items-center">
            <div className="mr-1.5 h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" />
            Copy Link
          </div>
        </div>
      </div>
    </AnalyticsCard>
  );
}
