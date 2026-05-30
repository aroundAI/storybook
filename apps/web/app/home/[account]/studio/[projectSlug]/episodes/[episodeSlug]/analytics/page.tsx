'use client';

/**
 * Episode Analytics Page
 *
 * Displays detailed analytics for a single episode.
 */
import { useEffect, useState } from 'react';

import dynamic from 'next/dynamic';

import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

import { useEpisodeContext } from '../_components/episode-context-provider';

const EpisodeAnalytics = dynamic(
  () =>
    import('@kit/content-analytics/components').then((mod) => ({
      default: mod.EpisodeAnalytics,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse p-8">
        <div className="h-8 w-48 rounded-lg bg-gray-200 dark:bg-[#1A1A1A]" />
        <div className="mt-4 h-64 rounded-xl bg-gray-100 dark:bg-[#1A1A1A]" />
      </div>
    ),
  },
);

export default function EpisodeAnalyticsPage() {
  const { episode } = useEpisodeContext();
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch analytics client-side using the episode ID from context
    async function fetchAnalytics() {
      try {
        const response = await fetch(`/api/analytics/episode/${episode.id}`);
        if (response.ok) {
          const data = await response.json();
          setAnalytics(data);
        }
      } catch (error) {
        console.error('Failed to fetch episode analytics:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchAnalytics();
  }, [episode.id]);

  return (
    <>
      <PageHeader
        title="Episode Analytics"
        description="Track performance for this episode."
      />
      <PageBody>
        {loading ? (
          <AnalyticsSkeleton />
        ) : analytics ? (
          <EpisodeAnalytics data={analytics as never} />
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">
              No analytics data available yet.
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              Publish this episode and sync analytics to see performance
              metrics.
            </p>
          </div>
        )}
      </PageBody>
    </>
  );
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
