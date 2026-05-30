'use client';

import { Skeleton } from '@kit/ui/skeleton';

export default function BillingLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Page header skeleton */}
      <header className="bg-card border-b px-6 py-4">
        <div className="mb-1">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-48" />
        </div>
      </header>

      {/* Content skeleton */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          {/* Current plan card */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <div className="mb-4 space-y-2">
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-4 w-44" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
            <div className="mt-4 flex gap-3">
              <Skeleton className="h-9 w-32 rounded-md" />
              <Skeleton className="h-9 w-32 rounded-md" />
            </div>
          </div>

          {/* Usage cards */}
          <div className="grid gap-4 sm:grid-cols-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <Skeleton className="mb-3 h-5 w-28" />
                <Skeleton className="mb-2 h-7 w-20" />
                <Skeleton className="h-2 w-full rounded-full" />
                <Skeleton className="mt-2 h-4 w-32" />
              </div>
            ))}
          </div>

          {/* Billing portal card */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <Skeleton className="mb-2 h-5 w-36" />
            <Skeleton className="mb-4 h-4 w-64" />
            <Skeleton className="h-9 w-40 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
