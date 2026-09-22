'use client';

import { PieChart } from 'lucide-react';

import { formatNumber } from '../../lib/format';
import { HorizontalProgress } from '../charts/horizontal-progress';
import { AnalyticsCard } from './analytics-card';

interface PlatformViews {
  platform: string;
  views: number;
}

interface PlatformSplitCardProps {
  /** Views per platform in the period. Empty when none were recorded. */
  platforms: PlatformViews[];
}

const PLATFORM_CONFIG: Record<string, { label: string; color: string }> = {
  tiktok: { label: 'TikTok', color: 'bg-gray-900 dark:bg-gray-200' },
  youtube: { label: 'YouTube', color: 'bg-red-600 dark:bg-red-500' },
  instagram: { label: 'Instagram', color: 'bg-purple-500 dark:bg-purple-400' },
};

/**
 * Each platform's share of the period's views. The footer states the
 * denominator; it used to read "Dominant performance on short-form"
 * whatever the rows said (KB-16).
 */
export function PlatformSplitCard({ platforms }: PlatformSplitCardProps) {
  const totalViews = platforms.reduce((sum, p) => sum + p.views, 0);

  return (
    <AnalyticsCard
      title="Platform Split"
      icon={PieChart}
      description="View distribution across platforms"
      footer={
        totalViews > 0
          ? `Share of ${formatNumber(totalViews)} views by platform.`
          : undefined
      }
      data-test="overview-platform-split"
    >
      {totalViews > 0 ? (
        <div className="flex flex-1 flex-col justify-center space-y-4">
          {platforms.map((platform) => {
            const config = PLATFORM_CONFIG[platform.platform.toLowerCase()] || {
              label: platform.platform,
              color: 'bg-gray-500',
            };

            return (
              <HorizontalProgress
                key={platform.platform}
                label={config.label}
                value={(platform.views / totalViews) * 100}
                color={config.color}
                height="sm"
              />
            );
          })}
        </div>
      ) : (
        <p
          className="text-xs text-gray-500 dark:text-gray-400"
          data-test="overview-platform-split-none"
        >
          No views recorded in this period.
        </p>
      )}
    </AnalyticsCard>
  );
}
