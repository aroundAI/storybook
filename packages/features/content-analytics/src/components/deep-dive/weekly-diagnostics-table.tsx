'use client';

import { AlertTriangle } from 'lucide-react';

import { Skeleton } from '@kit/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';

/** One recently-published video's diagnostic numbers. */
export interface DiagnosticRow {
  publishId: string;
  title: string;
  platform: string;
  publishedAt: string;
  views: number;
  impressions: number;
  /** Click-through rate, 0..1. */
  ctr: number;
  /** Null when the platform does not measure it (KB-111). */
  avgViewDurationSeconds: number | null;
  /** Set when the retention curve shows a sharp early drop. */
  cliff?: { position: number; drop: number; seconds?: number } | null;
}

interface WeeklyDiagnosticsTableProps {
  /** Videos published recently, newest first */
  rows: DiagnosticRow[];
  /** CTR below which packaging is flagged. Default 0.03. */
  lowCtrThreshold?: number;
  /** Opens a video's detail view */
  onSelect?: (publishId: string) => void;
  /** Which video's curve is open, so the row's control can report it. */
  selectedPublishId?: string | null;
  /** Loading state */
  isLoading?: boolean;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Weekly diagnostic view for recently published videos.
 *
 * This is a breakage check, not a strategy input: a 2% CTR means the
 * packaging failed on that video and a sharp retention cliff means its
 * intro failed. Fix the specific thing — do not generalize from one
 * video's numbers.
 */
export function WeeklyDiagnosticsTable({
  rows,
  lowCtrThreshold = 0.03,
  onSelect,
  selectedPublishId = null,
  isLoading = false,
}: WeeklyDiagnosticsTableProps) {
  if (isLoading) {
    return <WeeklyDiagnosticsTableSkeleton />;
  }

  if (rows.length === 0) {
    // Two cases, and the message must not pick one: nothing was published
    // in the window, or something was and has no metrics yet. Saying
    // "nothing published" in the second case sends a reader looking for a
    // publishing bug that is not there.
    return (
      <p className={'text-sm text-muted-foreground'}>
        Nothing to diagnose yet. A video appears here once its first analytics
        sync lands, so the last day or two of uploads may be missing.
      </p>
    );
  }

  return (
    <div className={'flex flex-col gap-3'}>
      <div className={'overflow-x-auto'}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Video</TableHead>
              <TableHead className={'text-right'}>Views</TableHead>
              <TableHead className={'text-right'}>Impressions</TableHead>
              <TableHead className={'text-right'}>CTR</TableHead>
              <TableHead className={'text-right'}>Avg duration</TableHead>
              <TableHead>Flags</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((row) => {
              const lowCtr = row.impressions > 0 && row.ctr < lowCtrThreshold;

              return (
                <TableRow
                  key={row.publishId}
                  className={onSelect ? 'cursor-pointer' : undefined}
                  // Click anywhere on the row as a mouse convenience. The
                  // row keeps its own role: `role="button"` here overrode
                  // the implicit `row`, which left the body as
                  // rowgroup → button → cell and took the cells out of the
                  // table's reading model — the numbers this table exists
                  // to convey stopped being row cells at all.
                  onClick={() => onSelect?.(row.publishId)}
                  data-test={'diagnostic-row'}
                >
                  <TableCell className={'max-w-[220px]'}>
                    {onSelect ? (
                      // A real button, so it is focusable, activates on
                      // Enter and Space without a hand-rolled key handler,
                      // and says what it opens. `aria-expanded` reports the
                      // panel's state rather than leaving it to be guessed.
                      <button
                        type={'button'}
                        className={
                          'block max-w-full truncate text-left font-medium underline-offset-2 hover:underline'
                        }
                        aria-expanded={selectedPublishId === row.publishId}
                        aria-controls={'retention-drilldown'}
                        onClick={(event) => {
                          // The row handles the click too; without this the
                          // drill-down would open and immediately reopen.
                          event.stopPropagation();
                          onSelect(row.publishId);
                        }}
                        data-test={'diagnostic-open'}
                      >
                        {row.title}
                      </button>
                    ) : (
                      <span className={'block truncate font-medium'}>
                        {row.title}
                      </span>
                    )}
                    <span className={'text-xs text-muted-foreground'}>
                      {row.platform} · {row.publishedAt.slice(0, 10)}
                    </span>
                  </TableCell>

                  <TableCell className={'text-right'}>
                    {row.views.toLocaleString()}
                  </TableCell>

                  <TableCell className={'text-right'}>
                    {row.impressions > 0
                      ? row.impressions.toLocaleString()
                      : '—'}
                  </TableCell>

                  <TableCell className={'text-right'}>
                    {row.impressions > 0
                      ? `${(row.ctr * 100).toFixed(1)}%`
                      : '—'}
                  </TableCell>

                  <TableCell className={'text-right'}>
                    {formatDuration(row.avgViewDurationSeconds)}
                  </TableCell>

                  <TableCell>
                    <span className={'flex flex-col gap-1'}>
                      {lowCtr ? (
                        <span
                          className={
                            'flex items-center gap-1 text-xs text-amber-600'
                          }
                        >
                          <AlertTriangle className={'h-3 w-3'} />
                          Packaging
                        </span>
                      ) : null}
                      {row.cliff ? (
                        <span
                          className={
                            'flex items-center gap-1 text-xs text-red-600'
                          }
                        >
                          <AlertTriangle className={'h-3 w-3'} />
                          Intro cliff
                        </span>
                      ) : null}
                      {!lowCtr && !row.cliff ? (
                        <span className={'text-xs text-muted-foreground'}>
                          —
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className={'text-xs text-muted-foreground'}>
        Diagnostic only. Flags point at a specific video&apos;s packaging or
        intro — they are not a reason to change the channel&apos;s strategy.
        Impressions and CTR need the YouTube bulk report ingest and appear about
        two days after publishing.
      </p>
    </div>
  );
}

export function WeeklyDiagnosticsTableSkeleton() {
  return (
    <div className={'flex flex-col gap-2'}>
      {Array.from({ length: 5 }).map((_, index) => (
        <Skeleton key={index} className={'h-12 w-full'} />
      ))}
    </div>
  );
}
