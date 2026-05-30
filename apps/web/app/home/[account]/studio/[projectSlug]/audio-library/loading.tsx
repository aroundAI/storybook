'use client';

import { Skeleton } from '@kit/ui/skeleton';

export default function AudioLibraryLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Page header skeleton */}
      <header className="bg-card border-b px-6 py-4">
        <Skeleton className="mb-1 h-7 w-36" />
        <Skeleton className="h-4 w-56" />
      </header>

      {/* Content skeleton */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Filter / tab bar */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex gap-2">
            <Skeleton className="h-9 w-20 rounded-md" />
            <Skeleton className="h-9 w-20 rounded-md" />
          </div>
          <Skeleton className="h-9 w-36 rounded-md" />
        </div>

        {/* Audio items list */}
        <div className="space-y-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              {/* Play button placeholder */}
              <Skeleton className="h-10 w-10 rounded-full" />

              {/* Waveform area */}
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
                <Skeleton className="h-8 w-full rounded" />
              </div>

              {/* Duration + actions */}
              <div className="flex items-center gap-3">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-8 w-8 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
