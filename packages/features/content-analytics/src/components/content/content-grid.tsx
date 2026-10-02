'use client';

import { Video } from 'lucide-react';

import { ANALYTICS_PLATFORMS } from '@kit/clickhouse';
import { Skeleton } from '@kit/ui/skeleton';

import { platformLabel } from '../../lib/platform-labels';
import type { ContentListItem } from '../../server/aggregation-queries';
import { ContentCard } from './content-card';

interface ContentGridProps {
  /** Content items to display */
  data: ContentListItem[] | undefined;
  /** Loading state */
  isLoading?: boolean;
  /** Click handler for content item */
  onItemClick?: (item: ContentListItem) => void;
}

export function ContentGrid({
  data,
  isLoading = false,
  onItemClick,
}: ContentGridProps) {
  if (isLoading) {
    return <ContentGridSkeleton />;
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Video className="mb-4 h-12 w-12 text-gray-400" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          No Content Published
        </h3>
        <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">
          Content will appear here once you publish videos to{' '}
          {ANALYTICS_PLATFORMS.map(platformLabel).join(', ')}.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 pb-12 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {data.map((item) => (
        <ContentCard
          key={item.publishId}
          publishId={item.publishId}
          title={item.publishTitle}
          subtitle={item.episodeTitle}
          thumbnailUrl={item.thumbnailUrl ?? undefined}
          platform={item.platform}
          publishedAt={item.publishedAt}
          views={item.views}
          likes={item.likes}
          comments={item.comments}
          engagementRate={item.engagementRate}
          onClick={onItemClick ? () => onItemClick(item) : undefined}
        />
      ))}
    </div>
  );
}

function ContentGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 pb-12 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800"
        >
          <Skeleton className="aspect-video w-full" />
          <div className="p-4">
            <Skeleton className="mb-2 h-5 w-3/4" />
            <Skeleton className="mb-4 h-3 w-1/2" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
