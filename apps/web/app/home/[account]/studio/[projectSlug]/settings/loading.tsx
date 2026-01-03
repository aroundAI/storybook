'use client';

import { Skeleton } from '@kit/ui/skeleton';

export default function SettingsLoading() {
    return (
        <div className="flex h-full flex-col">
            {/* Header skeleton */}
            <header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-2">
                    <Skeleton className="h-4 w-32" />
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Skeleton className="h-5 w-5" />
                        <Skeleton className="h-7 w-40" />
                    </div>
                    <div className="flex gap-2">
                        <Skeleton className="h-9 w-20" />
                        <Skeleton className="h-9 w-20" />
                    </div>
                </div>
            </header>

            {/* Content skeleton */}
            <div className="flex-1 p-6">
                <div className="mx-auto max-w-4xl space-y-6">
                    {/* Role badge */}
                    <Skeleton className="h-6 w-32" />

                    {/* Project info card */}
                    <div className="rounded-lg border p-6 space-y-4">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-4 w-64" />
                        <div className="grid grid-cols-2 gap-4 pt-4">
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-16" />
                                <Skeleton className="h-5 w-24" />
                            </div>
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-16" />
                                <Skeleton className="h-5 w-32" />
                            </div>
                        </div>
                    </div>

                    {/* Settings card */}
                    <div className="rounded-lg border p-6 space-y-4">
                        <Skeleton className="h-6 w-56" />
                        <div className="space-y-3">
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-10 w-full" />
                        </div>
                    </div>

                    {/* Members card */}
                    <div className="rounded-lg border p-6 space-y-4">
                        <Skeleton className="h-6 w-40" />
                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <Skeleton className="h-10 w-10 rounded-full" />
                                <Skeleton className="h-5 w-48" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
