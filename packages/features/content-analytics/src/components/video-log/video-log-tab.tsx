'use client';

import { useRef, useState } from 'react';

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import type { AnalyticsPlatform } from '@kit/clickhouse';
import { Button } from '@kit/ui/button';
import { Skeleton } from '@kit/ui/skeleton';

import { isUnavailable } from '../../lib/query-state';
import {
  DEFAULT_VIDEO_LOG_VIEW,
  type VideoLogSortColumn,
  type VideoLogView,
  nextVideoLogSort,
  videoLogPage,
  videoLogRangeLabel,
  videoLogRequest,
} from '../../lib/video-log-paging';
import { getVideoLogAction } from '../../server/video-log-actions';
import type { VideoLogRow } from '../../server/video-log-service';
import { ChannelFilter } from '../deep-dive/channel-filter';
import { AnalyticsCard } from '../overview/analytics-card';
import { SignalSurface } from '../signal-surface';
import { useSyncStatuses } from '../sync-status/sync-status';
import { useProjectChannels } from '../use-project-channels';
import { VideoLogTable } from './video-log-table';

/** The workbook's Sheet 1 columns; the action's own default. */
const CHECKPOINTS = [30, 90, 180, 365];

/** What the table is, in place of a figure: it has no total by design. */
const VIDEO_LOG_CLAIM = {
  figure: null,
  noFigure: 'One row per video.',
  sentence: `Views at ${CHECKPOINTS.slice(0, -1).join(', ')} and ${CHECKPOINTS.at(-1)} days after publishing, with lifetime views, impressions, click-through rate, watch duration and recorded revenue.`,
} as const;

export interface VideoLogTabProps {
  projectId: string;
  /** The page's platform filter (FILM-1709): in its own order, never empty. */
  platforms: AnalyticsPlatform[];
  /** The channel filter, shared with the Deep Dive tab. */
  connectionId: string | undefined;
  onConnectionChange: (connectionId: string | undefined) => void;
}

/**
 * The Video Log: one row per video, at fixed ages (FILM-1615).
 *
 * Sorting and paging are the server's. The page asks for one row more than
 * it shows, which is how "is there another page" is answered without a
 * count over the whole scope — and there is deliberately no total: the
 * table holds one page, and a footer summing it would be read as the log's.
 */
export function VideoLogTab({
  projectId,
  platforms,
  connectionId,
  onConnectionChange,
}: VideoLogTabProps) {
  const queryClient = useQueryClient();
  const channelsQuery = useProjectChannels(projectId);
  // The video whose signals are open (FILM-1719); a comparable's link
  // replaces it, so the surface follows the reader from video to video.
  const [signalVideoId, setSignalVideoId] = useState<string | null>(null);
  const openSignals = (videoId: string) => {
    setSignalVideoId(videoId);
    requestAnimationFrame(() =>
      document
        .getElementById('signal-surface')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };

  // The view, and the channel it was built for. Changing channel starts
  // again at the first page; keeping that here rather than in an effect
  // means the render after a channel change already asks for page one.
  const scopeKey = `${connectionId ?? 'all'}|${platforms.join(',')}`;
  const [state, setState] = useState<VideoLogView & { forScope: string }>({
    ...DEFAULT_VIDEO_LOG_VIEW,
    forScope: scopeKey,
  });

  // A channel or platform change starts again at the first page, and keeps the sort:
  // filtering is not a request to be re-sorted, and silently dropping the
  // column a reader chose makes the list reorder itself for no visible
  // reason.
  const view: VideoLogView =
    state.forScope === scopeKey
      ? state
      : {
          orderBy: state.orderBy,
          orderDirection: state.orderDirection,
          page: 0,
        };

  const queryKey = [
    'video-log',
    projectId,
    connectionId ?? 'all',
    platforms,
    view.orderBy,
    view.orderDirection,
    view.page,
  ];

  const query = useQuery({
    queryKey,
    queryFn: () =>
      getVideoLogAction({
        projectId,
        ...(connectionId ? { connectionId } : {}),
        platforms,
        checkpoints: CHECKPOINTS,
        ...videoLogRequest(view),
      }),
    placeholderData: keepPreviousData,
  });

  const setView = (next: VideoLogView) =>
    setState({ ...next, forScope: scopeKey });

  const onSort = (column: VideoLogSortColumn) =>
    setView(nextVideoLogSort(view, column));

  const { rows, hasMore } = videoLogPage(query.data ?? []);

  // KB-150: a row whose latest sync failed says so, rather than showing
  // figures that silently stopped moving.
  const syncQuery = useSyncStatuses({
    publishIds: rows.map((row) => row.videoId),
  });
  const syncById = Object.fromEntries(
    (syncQuery.data ?? []).map((status) => [status.publishId, status]),
  );

  // Which page the rows on screen actually are. While the next page is
  // being read the previous one is still shown (`keepPreviousData`), and
  // `view.page` has already moved — so a label built from it announced
  // "Rows 101–200" over rows 1–100. The label follows the data instead,
  // and the paging controls wait for it rather than letting a second click
  // skip the page being fetched.
  const settled = useRef({ page: view.page, count: rows.length });

  if (!query.isPlaceholderData) {
    settled.current = { page: view.page, count: rows.length };
  }

  const stale = query.isPlaceholderData;

  return (
    <div className={'flex flex-col gap-4'} data-test={'video-log-tab'}>
      <div className={'flex flex-wrap items-center justify-between gap-3'}>
        <p
          className={'max-w-2xl text-sm text-muted-foreground'}
          data-test={'video-log-scope-note'}
        >
          Every video on the selected platforms, with views at fixed ages so
          videos published months apart can be compared. The date range above
          does not apply here, and there is no total: the table loads one page
          at a time.
        </p>

        <ChannelFilter
          channels={channelsQuery.data ?? []}
          value={connectionId}
          onChange={onConnectionChange}
          isLoading={channelsQuery.isLoading}
          isError={isUnavailable(channelsQuery)}
        />
      </div>

      {/* On the one card shell (FILM-1707): the table's figures carry the
          chip every other tab's do. */}
      <AnalyticsCard
        title={'Video Log'}
        metricFamily={['engagement', 'reach', 'watch_time', 'revenue']}
        claim={VIDEO_LOG_CLAIM}
        details={null}
        data-test={'video-log-card'}
      >
        {query.isLoading ? (
          <VideoLogTableSkeleton />
        ) : isUnavailable(query) ? (
          <div
            className={'flex flex-col items-start gap-2 rounded-lg border p-6'}
            role={'alert'}
            data-test={'video-log-error'}
          >
            <p className={'text-sm font-medium'}>
              The Video Log could not be loaded.
            </p>
            <Button
              variant={'outline'}
              size={'sm'}
              onClick={() => void query.refetch()}
              data-test={'video-log-retry'}
            >
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            hasChannelFilter={Boolean(connectionId)}
            page={view.page}
            onFirstPage={() => setView({ ...view, page: 0 })}
          />
        ) : (
          <>
            {syncQuery.isError ? (
              <p
                className={'text-sm text-muted-foreground'}
                role={'alert'}
                data-test={'video-log-sync-status-error'}
              >
                Whether these videos&rsquo; latest syncs succeeded could not be
                loaded.
              </p>
            ) : null}

            <VideoLogTable
              rows={rows}
              syncById={syncById}
              checkpoints={CHECKPOINTS}
              view={view}
              onSort={onSort}
              onNoteSaved={(publishId, saved) => {
                // Patch the row in place so the note stays on screen, then
                // re-query so the next read agrees with the database.
                queryClient.setQueryData<VideoLogRow[]>(queryKey, (current) =>
                  current?.map((row) =>
                    row.videoId === publishId
                      ? {
                          ...row,
                          analyticsNote: saved.note,
                          analyticsNoteUpdatedAt: saved.updatedAt,
                        }
                      : row,
                  ),
                );
                void queryClient.invalidateQueries({ queryKey });
              }}
              onNotePermissionLost={() =>
                void queryClient.invalidateQueries({ queryKey })
              }
              onOpenSignals={openSignals}
            />

            <div className={'flex items-center justify-between gap-3'}>
              <span
                className={'text-sm text-muted-foreground'}
                data-test={'video-log-range'}
              >
                {videoLogRangeLabel(
                  settled.current.page,
                  settled.current.count,
                )}
              </span>

              <span className={'flex gap-2'}>
                <Button
                  variant={'outline'}
                  size={'sm'}
                  disabled={view.page === 0 || stale}
                  onClick={() => setView({ ...view, page: view.page - 1 })}
                  data-test={'video-log-previous'}
                >
                  Previous
                </Button>
                <Button
                  variant={'outline'}
                  size={'sm'}
                  disabled={!hasMore || stale}
                  onClick={() => setView({ ...view, page: view.page + 1 })}
                  data-test={'video-log-next'}
                >
                  Next
                </Button>
              </span>
            </div>
          </>
        )}
      </AnalyticsCard>

      {signalVideoId ? (
        <SignalSurface
          projectId={projectId}
          videoId={signalVideoId}
          onSelectVideo={openSignals}
          onClose={() => setSignalVideoId(null)}
        />
      ) : null}
    </div>
  );
}

function EmptyState({
  hasChannelFilter,
  page,
  onFirstPage,
}: {
  hasChannelFilter: boolean;
  page: number;
  onFirstPage: () => void;
}) {
  if (page > 0) {
    return (
      <div
        className={'flex flex-col items-start gap-2 rounded-lg border p-6'}
        data-test={'video-log-past-end'}
      >
        <p className={'text-sm font-medium'}>No more videos.</p>
        <Button variant={'outline'} size={'sm'} onClick={onFirstPage}>
          Back to first page
        </Button>
      </div>
    );
  }

  return (
    <div
      className={'flex flex-col gap-2 rounded-lg border p-6'}
      data-test={'video-log-empty'}
    >
      <p className={'text-sm font-medium'}>
        {hasChannelFilter
          ? 'No videos from this channel have analytics yet.'
          : 'No videos with analytics yet.'}
      </p>
      <p className={'max-w-md text-sm text-muted-foreground'}>
        Videos appear here after their first analytics sync.
      </p>
    </div>
  );
}

export function VideoLogTableSkeleton() {
  return (
    <div
      className={'flex flex-col gap-2 rounded-lg border p-4'}
      aria-busy={'true'}
      data-test={'video-log-loading'}
    >
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className={'h-8 w-full'} />
      ))}
    </div>
  );
}
