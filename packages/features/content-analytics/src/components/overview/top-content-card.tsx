'use client';

import { format } from 'date-fns';
import { Trophy } from 'lucide-react';

import { formatNumber, formatPercent } from '../../lib/format';
import { AnalyticsCard } from './analytics-card';

interface TopContentItem {
  id: string;
  title: string;
  thumbnailUrl?: string;
  publishedAt: string;
  platform: string;
  views: number;
  engagementRate: number;
}

interface TopContentCardProps {
  /** Top performing content items */
  content: TopContentItem[];
  /** Callback when "View All" is clicked */
  onViewAll?: () => void;
}

const PLATFORM_BADGE_STYLES: Record<string, string> = {
  tiktok: 'bg-black text-white',
  youtube: 'bg-red-600 text-white',
  instagram:
    'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 text-white',
};

export function TopContentCard({ content, onViewAll }: TopContentCardProps) {
  const items = content.slice(0, 2); // Show max 2 items

  return (
    <AnalyticsCard
      title="Top Performing Content"
      icon={Trophy}
      description="Best performing videos by views"
      colSpan={2}
    >
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold text-gray-500 dark:text-gray-400" />
        {onViewAll && (
          <button
            onClick={onViewAll}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            View All
          </button>
        )}
      </div>
      <div className="mt-2 flex-1 overflow-hidden">
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex cursor-pointer items-center rounded-lg p-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <div className="relative h-10 w-16 flex-shrink-0 overflow-hidden rounded-md bg-gray-200 dark:bg-gray-700">
                {item.thumbnailUrl ? (
                  <img
                    src={item.thumbnailUrl}
                    alt={item.title}
                    className="h-full w-full object-cover opacity-80"
                  />
                ) : (
                  <div className="h-full w-full bg-gray-300 dark:bg-gray-600" />
                )}
              </div>
              <div className="ml-3 min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-900 dark:text-white">
                  {item.title}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {format(new Date(item.publishedAt), 'MMM d, yyyy')}
                </div>
              </div>
              <div className="flex items-center space-x-4 text-xs font-medium text-gray-600 dark:text-gray-400">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] ${PLATFORM_BADGE_STYLES[item.platform.toLowerCase()] || 'bg-gray-500 text-white'}`}
                >
                  {item.platform}
                </span>
                <span>{formatNumber(item.views)} Views</span>
                <span className="font-semibold text-green-600 dark:text-green-400">
                  {formatPercent(item.engagementRate)} ER
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AnalyticsCard>
  );
}
