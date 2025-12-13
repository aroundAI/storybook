/**
 * Episode Analytics Page
 *
 * Displays detailed analytics for a single episode.
 */

import { Suspense } from 'react';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

import { getEpisodeAnalytics } from '@kit/content-analytics/server';
import { EpisodeAnalytics } from '@kit/content-analytics/components';

interface PageParams {
    params: Promise<{
        account: string;
        projectId: string;
        episodeId: string;
    }>;
}

export default async function EpisodeAnalyticsPage({ params }: PageParams) {
    const { episodeId } = await params;

    return (
        <>
            <PageHeader title="Episode Analytics" description="Track performance for this episode." />
            <PageBody>
                <Suspense fallback={<AnalyticsSkeleton />}>
                    <EpisodeAnalyticsLoader episodeId={episodeId} />
                </Suspense>
            </PageBody>
        </>
    );
}

async function EpisodeAnalyticsLoader({ episodeId }: { episodeId: string }) {
    const data = await getEpisodeAnalytics(episodeId);

    if (!data) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-muted-foreground">No analytics data available yet.</p>
                <p className="text-sm text-muted-foreground mt-2">
                    Publish this episode and sync analytics to see performance metrics.
                </p>
            </div>
        );
    }

    return <EpisodeAnalytics data={data} />;
}

function AnalyticsSkeleton() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-8 w-24" />
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
                {Array.from({ length: 7 }).map((_, i) => (
                    <Skeleton key={i} className="h-24" />
                ))}
            </div>
            <Skeleton className="h-64" />
        </div>
    );
}
