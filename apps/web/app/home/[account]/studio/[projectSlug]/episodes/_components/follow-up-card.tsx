'use client';

import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';

import { getFollowUpPreviewAction } from '@kit/episodes/server/actions';
import type { FollowUpSnapshot } from '@kit/generation/follow-up';
import { refusalMessage, unwrap } from '@kit/next/action-result';
import { Skeleton } from '@kit/ui/skeleton';

/**
 * FILM-2206: what a follow-up carries from the episode it follows up, read
 * only. The same snapshot is frozen into the new episode when it is
 * created, and its story brief leads with it.
 */
export function FollowUpCard({
  projectId,
  episodeId,
}: {
  projectId: string;
  episodeId: string;
}) {
  const query = useQuery({
    queryKey: ['follow-up-preview', episodeId],
    queryFn: () => unwrap(getFollowUpPreviewAction({ projectId, episodeId })),
  });

  return (
    <section
      className="space-y-2 rounded-lg border bg-muted/40 p-3 text-xs"
      data-test="follow-up-card"
    >
      <h4 className="flex items-center gap-1.5 text-sm font-medium">
        <TrendingUp className="h-4 w-4" />
        What worked
      </h4>

      {query.isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : query.isError ? (
        <p role="alert" className="text-destructive">
          {refusalMessage(query.error, 'What worked could not be read.')}
        </p>
      ) : query.data ? (
        <FollowUpDetail snapshot={query.data} />
      ) : null}
    </section>
  );
}

function FollowUpDetail({ snapshot }: { snapshot: FollowUpSnapshot }) {
  const { traits, performance } = snapshot;
  const facts = [
    traits.hook && `Hook: “${traits.hook}”`,
    traits.sceneCount !== null && `${traits.sceneCount} scenes`,
    traits.shotPacing &&
      `${traits.shotPacing.shots} shots, ${traits.shotPacing.meanShotSeconds.toFixed(1)}s each on average`,
    traits.dialogueDensity?.linesPerMinute != null &&
      `${traits.dialogueDensity.linesPerMinute.toFixed(1)} dialogue lines a minute`,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <div className="space-y-2 text-muted-foreground">
      <p>
        From Episode {snapshot.number}, “{snapshot.title}”. The story brief
        leads with this.
      </p>

      {facts.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4" data-test="follow-up-traits">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}

      {performance.status === 'unmeasured' ? (
        <p data-test="follow-up-unmeasured">
          No performance figures: {performance.reason}
        </p>
      ) : performance.videos.length === 0 ? (
        <p data-test="follow-up-unmeasured">
          No published video of it has figures yet.
        </p>
      ) : (
        <table className="w-full" data-test="follow-up-performance">
          <thead>
            <tr className="text-left">
              <th className="font-medium">Video</th>
              <th className="font-medium">Retention</th>
              <th className="font-medium">First-week views</th>
            </tr>
          </thead>
          <tbody>
            {performance.videos.map((video) => (
              <tr key={`${video.platform}-${video.publishedAt}`}>
                <td>
                  {video.platform} · {video.contentType}
                </td>
                <td>
                  {figure(video.retentionPercent, '%')}
                  <Median
                    value={video.projectMedian.retentionPercent}
                    unit="%"
                  />
                </td>
                <td>
                  {figure(video.viewsFirstWeek)}
                  <Median value={video.projectMedian.viewsFirstWeek} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Median({ value, unit = '' }: { value: number | null; unit?: string }) {
  if (value === null) return null;

  return <span className="opacity-70"> (median {figure(value, unit)})</span>;
}

function figure(value: number | null, unit = '') {
  if (value === null) return '—';

  return `${Math.round(value).toLocaleString('en-US')}${unit}`;
}
