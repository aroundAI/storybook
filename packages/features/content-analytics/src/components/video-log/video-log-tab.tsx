'use client';

import { useState } from 'react';

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

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
import {
  type VideoLogRow,
  getVideoLogAction,
} from '../../server/video-log-actions';
import { ChannelFilter } from '../deep-dive/channel-filter';
import { useProjectChannels } from '../use-project-channels';
import { VideoLogTable } from './video-log-table';

/** The workbook's Sheet 1 columns; the action's own default. */
const CHECKPOINTS = [30, 90, 180, 365];

export interface VideoLogTabProps {
  projectId: string;
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
  connectionId,
  onConnectionChange,
}: VideoLogTabProps) {
  const queryClient = useQueryClient();
  const channelsQuery = useProjectChannels(projectId);

  // The view, and the channel it was built for. Changing channel starts
  // again at the first page; keeping that here rather than in an effect
  // means the render after a channel change already asks for page one.
  const [state, setState] = useState<
    VideoLogView & { forConnection: string | undefined }
  >({ ...DEFAULT_VIDEO_LOG_VIEW, forConnection: connectionId });

  const view: VideoLogView =
    state.forConnection === connectionId
      ? state
      : { ...DEFAULT_VIDEO_LOG_VIEW };

  const queryKey = [
    'video-log',
    projectId,
    connectionId ?? 'all',
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
        checkpoints: CHECKPOINTS,
        ...videoLogRequest(view),
      }),
    placeholderData: keepPreviousData,
  });

  const setView = (next: VideoLogView) =>
    setState({ ...next, forConnection: connectionId });

  const onSort = (column: VideoLogSortColumn) =>
    setView(nextVideoLogSort(view, column));

  const { rows, hasMore } = videoLogPage(query.data ?? []);

  return (
    <div className={'flex flex-col gap-4'} data-test={'video-log-tab'}>
      <div className={'flex flex-wrap items-center justify-between gap-3'}>
        <p
          className={'max-w-2xl text-sm text-muted-foreground'}
          data-test={'video-log-scope-note'}
        >
          Every video in this project, with views at fixed ages so videos
          published months apart can be compared. The date range and platform
          filters above do not apply here, and there is no total: the table
          loads one page at a time.
        </p>

        <ChannelFilter
          channels={channelsQuery.data ?? []}
          value={connectionId}
          onChange={onConnectionChange}
          isLoading={channelsQuery.isLoading}
          isError={isUnavailable(channelsQuery)}
        />
      </div>

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
          <VideoLogTable
            rows={rows}
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
          />

          <div className={'flex items-center justify-between gap-3'}>
            <span
              className={'text-sm text-muted-foreground'}
              data-test={'video-log-range'}
            >
              {videoLogRangeLabel(view.page, rows.length)}
            </span>

            <span className={'flex gap-2'}>
              <Button
                variant={'outline'}
                size={'sm'}
                disabled={view.page === 0}
                onClick={() => setView({ ...view, page: view.page - 1 })}
                data-test={'video-log-previous'}
              >
                Previous
              </Button>
              <Button
                variant={'outline'}
                size={'sm'}
                disabled={!hasMore}
                onClick={() => setView({ ...view, page: view.page + 1 })}
                data-test={'video-log-next'}
              >
                Next
              </Button>
            </span>
          </div>
        </>
      )}
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
