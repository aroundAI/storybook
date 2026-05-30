'use client';

import { Skeleton } from '@kit/ui/skeleton';

export default function AssetsLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Back link skeleton */}
      <div className="px-6 pt-6">
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Page header skeleton */}
      <header className="bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="mb-1 h-7 w-24" />
            <Skeleton className="h-4 w-52" />
          </div>
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      </header>

      {/* Content skeleton */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Tab bar */}
        <div className="mb-6 flex gap-4 border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-28" />
        </div>

        {/* Asset card grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div
              key={i}
              className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <Skeleton className="aspect-square w-full" />
              <div className="space-y-2 p-4">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-24" />
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
