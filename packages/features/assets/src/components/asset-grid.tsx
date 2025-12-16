'use client';

import type { ReactNode } from 'react';

import { cn } from '@kit/ui/utils';

import { AssetCardSkeleton } from './asset-card-skeleton';

interface AssetGridProps {
  children: ReactNode;
  isLoading?: boolean;
  skeletonCount?: number;
}

export function AssetGrid({
  children,
  isLoading = false,
  skeletonCount = 8,
  className,
}: AssetGridProps & { className?: string }) {
  if (isLoading) {
    return (
      <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", className)}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <AssetCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", className)}>
      {children}
    </div>
  );
}
