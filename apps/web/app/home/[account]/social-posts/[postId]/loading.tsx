'use client';

import { Skeleton } from '@kit/ui/skeleton';

export default function SocialPostDetailLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Page header skeleton */}
      <header className="border-b bg-card px-6 py-4">
        <div className="mb-1">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
      </header>

      {/* Content skeleton */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Back link */}
        <div className="mb-6">
          <Skeleton className="h-4 w-36" />
        </div>

        {/* Post detail card */}
        <div className="max-w-3xl space-y-6">
          {/* Status bar */}
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-32 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>

          {/* Post content preview */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-4 flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <Skeleton className="mt-4 h-48 w-full rounded-lg" />
          </div>

          {/* Analytics / metrics */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <Skeleton className="mb-4 h-5 w-28" />
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-7 w-20" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
