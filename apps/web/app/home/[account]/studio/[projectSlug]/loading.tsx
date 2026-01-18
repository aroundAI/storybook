'use client';

import { Skeleton } from '@kit/ui/skeleton';

export default function StudioLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Header skeleton */}
      <header className="bg-card border-b border-gray-200 px-6 py-4">
        <div className="mb-2">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-48" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </header>

      {/* Content skeleton */}
      <div className="flex-1 p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>

          {/* Main content card */}
          <Skeleton className="h-64 rounded-lg" />

          {/* Secondary content */}
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-48 rounded-lg" />
            <Skeleton className="h-48 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
