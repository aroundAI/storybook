'use client';

import { Skeleton } from '@kit/ui/skeleton';

export default function EpisodesLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Header skeleton */}
      <header className="bg-card border-b border-gray-200 px-6 py-4">
        <div className="mb-2">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-7 w-28" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
      </header>

      {/* Content skeleton */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {/* Season section */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>

            {/* Episode items */}
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4 py-3">
                  <Skeleton className="h-16 w-24 rounded" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-64" />
                  </div>
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
