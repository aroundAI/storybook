'use client';

/**
 * Episode Analytics Page
 *
 * Displays detailed analytics for a single episode, and its audience
 * retention curve where the platform reports one.
 *
 * Reads through a server action rather than an API route. It used to fetch
 * `/api/analytics/episode/{id}`, which was never built — the 404 was
 * swallowed by an `if (response.ok)` and the page rendered "No analytics
 * data available yet." for every episode, always (FILM-1616).
 */
import dynamic from 'next/dynamic';

import { useQuery } from '@tanstack/react-query';

import {
  RetentionCurveChart,
  RetentionCurveChartSkeleton,
} from '@kit/content-analytics/components';
import { unwrap } from '@kit/content-analytics/lib/action-result';
import {
  getEpisodeAnalyticsAction,
  getEpisodeRetentionPublishAction,
  getRetentionCurveAction,
} from '@kit/content-analytics/server/diagnostics-actions';
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
    loading: () => <AnalyticsSkeleton />,
  },
);

export default function EpisodeAnalyticsPage() {
  const { episode } = useEpisodeContext();

  const analyticsQuery = useQuery({
    queryKey: ['episode-analytics', episode.id],
    queryFn: () => unwrap(getEpisodeAnalyticsAction({ episodeId: episode.id })),
  });

  // The curve is keyed on a publish, not an episode, and only YouTube
  // reports one — so this resolves the episode's YouTube publish first and
  // renders nothing when there is none.
  const publishQuery = useQuery({
    queryKey: ['episode-retention-publish', episode.id],
    queryFn: () =>
      unwrap(getEpisodeRetentionPublishAction({ episodeId: episode.id })),
  });

  const publishId = publishQuery.data?.publishId ?? null;

  const curveQuery = useQuery({
    queryKey: ['retention-curve', publishId],
    queryFn: () => unwrap(getRetentionCurveAction({ publishId: publishId! })),
    enabled: publishId !== null,
  });

  return (
    <>
      <PageHeader
        title="Episode Analytics"
        description="Track performance for this episode."
      />
      <PageBody>
        {analyticsQuery.isLoading ? (
          <AnalyticsSkeleton />
        ) : analyticsQuery.data ? (
          <EpisodeAnalytics data={analyticsQuery.data as never} />
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">
              No analytics data available yet.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Publish this episode and sync analytics to see performance
              metrics.
            </p>
          </div>
        )}

        {publishId ? (
          <section
            className="mt-6 flex flex-col gap-2 border-t pt-6"
            data-test="episode-retention"
          >
            <h3 className="text-base font-semibold">Audience retention</h3>

            {curveQuery.isLoading ? (
              <RetentionCurveChartSkeleton />
            ) : (
              // No durationSeconds until FILM-1710 lands a real asset
              // duration: video_dim's column is the episode's, so a Short's
              // cliff would be labelled past the end of the clip.
              <RetentionCurveChart points={curveQuery.data?.points ?? []} />
            )}
          </section>
        ) : null}
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
