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
  avgViewDurationSeconds: number;
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
  /** Loading state */
  isLoading?: boolean;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—';
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
  isLoading = false,
}: WeeklyDiagnosticsTableProps) {
  if (isLoading) {
    return <WeeklyDiagnosticsTableSkeleton />;
  }

  if (rows.length === 0) {
    return (
      <p className={'text-sm text-muted-foreground'}>
        Nothing published recently enough to diagnose.
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
                  onClick={() => onSelect?.(row.publishId)}
                >
                  <TableCell className={'max-w-[220px]'}>
                    <span className={'block truncate font-medium'}>
                      {row.title}
                    </span>
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
