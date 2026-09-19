'use client';

import Image from 'next/image';

import { format } from 'date-fns';

import { formatNumber, formatPercent } from '../../lib/format';

interface ContentCardProps {
  /** Content title */
  title: string;
  /** Episode or subtitle */
  subtitle?: string;
  /** Thumbnail URL */
  thumbnailUrl?: string;
  /** Platform name */
  platform: string;
  /** Published date */
  publishedAt: string;
  /** View count */
  views: number;
  /** Like count */
  likes: number;
  /** Comment count */
  comments: number;
  /** Engagement rate percentage */
  engagementRate: number;
  /** Click handler */
  onClick?: () => void;
}

const PLATFORM_BADGE_STYLES: Record<string, { bg: string; dot: string }> = {
  tiktok: {
    bg: 'bg-black text-white',
    dot: 'bg-cyan-400',
  },
  youtube: {
    bg: 'bg-red-600 text-white',
    dot: 'bg-white',
  },
  instagram: {
    bg: 'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 text-white',
    dot: 'bg-white',
  },
};

export function ContentCard({
  title,
  subtitle,
  thumbnailUrl,
  platform,
  publishedAt,
  views,
  likes,
  comments,
  engagementRate,
  onClick,
}: ContentCardProps) {
  const platformKey = platform.toLowerCase();
  const platformStyle = PLATFORM_BADGE_STYLES[platformKey] || {
    bg: 'bg-gray-500 text-white',
    dot: 'bg-white',
  };

  // Determine engagement color
  const engagementColor =
    engagementRate > 5
      ? 'text-green-600 dark:text-green-400'
      : engagementRate > 2
        ? 'text-yellow-600 dark:text-yellow-400'
        : 'text-gray-500 dark:text-gray-400';

  return (
    <div
      className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-300 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900"
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-gray-200 dark:bg-gray-800">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt={title}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 400px"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-2xl text-gray-400">🎬</span>
          </div>
        )}
        {/* Platform Badge */}
        <div
          className={`absolute top-3 right-3 flex items-center rounded-full px-2 py-1 text-[10px] font-bold shadow-lg ${platformStyle.bg}`}
        >
          <span
            className={`mr-1.5 h-1.5 w-1.5 rounded-full ${platformStyle.dot}`}
          />
          {platform.charAt(0).toUpperCase() + platform.slice(1)}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-4">
        {/* Title Section */}
        <div className="mb-3">
          <h3
            className="truncate font-semibold text-gray-900 dark:text-white"
            title={title}
          >
            {title}
          </h3>
          {subtitle && (
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
              {subtitle}
            </p>
          )}
        </div>

        {/* Metrics Grid */}
        <div className="mt-auto grid grid-cols-2 gap-x-2 gap-y-3 border-t border-gray-200 pt-3 text-sm dark:border-gray-700">
          <div className="flex flex-col">
            <span className="mb-0.5 text-xs text-gray-400">Views</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {formatNumber(views)}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="mb-0.5 text-xs text-gray-400">Likes</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {formatNumber(likes)}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="mb-0.5 text-xs text-gray-400">Comments</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {formatNumber(comments)}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="mb-0.5 text-xs text-gray-400">Engagement</span>
            <span className={`font-medium ${engagementColor}`}>
              {formatPercent(engagementRate)}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-3 flex items-center justify-between border-t border-dashed border-gray-200 pt-2 text-[10px] text-gray-400 dark:border-gray-700 dark:text-gray-500">
          <span>Published</span>
          <span>{format(new Date(publishedAt), 'MMM d, yyyy')}</span>
        </div>
      </div>
    </div>
  );
}
