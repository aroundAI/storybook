'use client';

import type { ReactNode } from 'react';

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
}: AssetGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <AssetCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </div>
  );
}
