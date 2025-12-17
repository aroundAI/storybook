'use client';

import { PieChart } from 'lucide-react';

import { HorizontalProgress } from '../charts/horizontal-progress';
import { AnalyticsCard } from './analytics-card';

interface PlatformData {
  platform: string;
  percentage: number;
}

interface PlatformSplitCardProps {
  /** Platform breakdown data */
  platforms: PlatformData[];
}

const PLATFORM_CONFIG: Record<string, { label: string; color: string }> = {
  tiktok: { label: 'TikTok', color: 'bg-gray-900 dark:bg-gray-200' },
  youtube: { label: 'YouTube', color: 'bg-red-600 dark:bg-red-500' },
  instagram: { label: 'Instagram', color: 'bg-purple-500 dark:bg-purple-400' },
};

export function PlatformSplitCard({ platforms }: PlatformSplitCardProps) {
  return (
    <AnalyticsCard
      title="Platform Split"
      icon={PieChart}
      description="View distribution across platforms"
      footer="Dominant performance on short-form"
    >
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
              value={platform.percentage}
              color={config.color}
              height="sm"
            />
          );
        })}
      </div>
    </AnalyticsCard>
  );
}
