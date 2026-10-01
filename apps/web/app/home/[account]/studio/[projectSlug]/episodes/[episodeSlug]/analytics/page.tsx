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
  EpisodeSyncStatus,
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
        {/* Its own read, beside the figures and not inside them: a failed
            sync has to be visible whether or not there are figures to show,
            and whether or not the figures could be loaded (KB-150). */}
        <div className="mb-6 empty:hidden">
          <EpisodeSyncStatus episodeId={episode.id} />
        </div>

        {analyticsQuery.isLoading ? (
          <AnalyticsSkeleton />
        ) : analyticsQuery.isError ? (
          <div
            className="flex flex-col items-center justify-center py-12 text-center"
            role="alert"
            data-test="episode-analytics-error"
          >
            <p className="text-muted-foreground">
              Episode analytics could not be loaded.
            </p>
          </div>
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

        {publishQuery.isError ? (
          // The lookup failing is not the episode having no video. The
          // action stopped discarding that error; discarding it here
          // instead would put the section back to vanishing silently.
          <section
            className="mt-6 flex flex-col gap-2 border-t pt-6"
            data-test="episode-retention"
          >
            <h3 className="text-base font-semibold">Audience retention</h3>
            {/* A distinct id from the curve's error below. The two are
                different failures — no video found, versus a curve that
                could not be read — and a guard asserting one should not be
                satisfiable by the other. They are not confusable today,
                because this branch runs only when no publish id resolved
                and the curve section needs one, but sharing an id invites
                exactly that the next time a failure state is added here. */}
            <p
              className="text-sm text-muted-foreground"
              role="alert"
              data-test="episode-video-error"
            >
              That episode&rsquo;s video could not be found.
            </p>
          </section>
        ) : publishId ? (
          <section
            className="mt-6 flex flex-col gap-2 border-t pt-6"
            data-test="episode-retention"
          >
            <h3 className="text-base font-semibold">Audience retention</h3>

            {curveQuery.isLoading ? (
              <RetentionCurveChartSkeleton />
            ) : curveQuery.isError ? (
              // A failed read is not an absent curve. `data ?? []` would
              // render the two identically, so a refused or broken request
              // would show as "no retention curve available" — the mistake
              // `QueryState` exists to prevent on the Deep Dive tab.
              <p
                className="text-sm text-muted-foreground"
                role="alert"
                data-test="episode-retention-error"
              >
                That retention curve could not be loaded.
              </p>
            ) : (
              // The asset's own duration (FILM-1710), or `duration_unknown`
              // — in which case the cliff is described without a timestamp.
              <RetentionCurveChart
                points={curveQuery.data?.points ?? []}
                duration={curveQuery.data?.duration}
              />
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
