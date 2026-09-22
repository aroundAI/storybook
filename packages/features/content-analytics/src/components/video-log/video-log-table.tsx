'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';

import { languageName } from '../../lib/language-labels';
import { localDateOf } from '../../lib/local-date';
import {
  checkpointState,
  isPartial,
  parseUtcTimestamp,
  qualityStates,
} from '../../lib/video-log-cells';
import type {
  VideoLogSortColumn,
  VideoLogView,
} from '../../lib/video-log-paging';
import type { VideoLogRow } from '../../server/video-log-actions';
import {
  CheckpointCell,
  PartialBadge,
  QualityCell,
  RevenueCell,
  formatPercentValue,
  formatRatio,
  formatSeconds,
  formatViews,
} from './cells';
import { NoteCell } from './note-cell';

export interface VideoLogTableProps {
  rows: VideoLogRow[];
  /** The checkpoint ages the rows carry, in the order they are shown. */
  checkpoints: number[];
  view: VideoLogView;
  onSort: (column: VideoLogSortColumn) => void;
  /** Patches one row's note in place after a save, before the re-query. */
  onNoteSaved: (
    publishId: string,
    saved: { note: string | null; updatedAt: string | null },
  ) => void;
  onNotePermissionLost: () => void;
}

/**
 * The workbook's Sheet 1: one row per video, with views at fixed ages
 * beside the lifetime quality columns (FILM-1615).
 *
 * Every cell that is not a real measurement says why, through the pure
 * functions in `lib/video-log-cells`, so the four checkpoint columns cannot
 * disagree about what an empty figure means.
 *
 * Only the three columns the server can order by are sortable. Sorting the
 * rest in the browser would sort the page on screen while presenting itself
 * as a sort of the log.
 */
export function VideoLogTable({
  rows,
  checkpoints,
  view,
  onSort,
  onNoteSaved,
  onNotePermissionLost,
}: VideoLogTableProps) {
  return (
    <div
      className={'w-full overflow-x-auto rounded-lg border'}
      data-test={'video-log-table'}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead
              column={'title'}
              label={'Video'}
              view={view}
              onSort={onSort}
              className={'sticky left-0 z-10 min-w-56 bg-background'}
            />
            <SortableHead
              column={'published_at'}
              label={'Published'}
              view={view}
              onSort={onSort}
            />
            <TableHead>Channel</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead>Format</TableHead>
            <TableHead>Language</TableHead>

            {checkpoints.map((days) => (
              <TableHead key={days} className={'text-right'}>
                Views in first {days} days
              </TableHead>
            ))}

            <SortableHead
              column={'lifetime_views'}
              label={'Lifetime views'}
              view={view}
              onSort={onSort}
              className={'text-right'}
            />
            <TableHead className={'text-right'}>
              Impressions (lifetime)
            </TableHead>
            <TableHead className={'text-right'}>CTR (lifetime)</TableHead>
            <TableHead className={'text-right'}>
              Avg view duration (lifetime)
            </TableHead>
            <TableHead className={'text-right'}>
              Avg % viewed (lifetime)
            </TableHead>
            <TableHead className={'text-right'}>Revenue (lifetime)</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((row) => {
            const quality = qualityStates(row);
            const published = parseUtcTimestamp(row.publishedAt);

            return (
              <TableRow key={row.videoId} data-test={`video-log-row`}>
                <TableCell
                  className={'sticky left-0 z-10 bg-background font-medium'}
                >
                  <span className={'flex items-center gap-2'}>
                    <span className={'line-clamp-2 max-w-56'}>
                      {row.title || 'Untitled'}
                    </span>
                    {isPartial(row) ? (
                      <PartialBadge lagDays={row.ingestLagDays!} />
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className={'whitespace-nowrap'}>
                  {published ? localDateOf(published) : '—'}
                </TableCell>
                <TableCell>{row.channelName}</TableCell>
                <TableCell>{row.platform}</TableCell>
                <TableCell>{row.contentType}</TableCell>
                <TableCell data-test="video-log-language">
                  {languageName(row.language)}
                </TableCell>

                {checkpoints.map((days) => (
                  <TableCell key={days} className={'text-right'}>
                    <CheckpointCell
                      state={checkpointState(row, days)}
                      days={days}
                    />
                  </TableCell>
                ))}

                <TableCell className={'text-right'}>
                  <QualityCell
                    state={quality.lifetimeViews}
                    format={formatViews}
                    testId={'lifetime-views'}
                  />
                </TableCell>
                <TableCell className={'text-right'}>
                  <QualityCell
                    state={quality.impressions}
                    format={formatViews}
                    testId={'impressions'}
                  />
                </TableCell>
                <TableCell className={'text-right'}>
                  <QualityCell
                    state={quality.ctr}
                    format={formatRatio}
                    testId={'ctr'}
                  />
                </TableCell>
                <TableCell className={'text-right'}>
                  <QualityCell
                    state={quality.avgViewDuration}
                    format={formatSeconds}
                    testId={'avg-duration'}
                  />
                </TableCell>
                <TableCell className={'text-right'}>
                  <QualityCell
                    state={quality.avgViewPercentage}
                    format={formatPercentValue}
                    testId={'avg-percentage'}
                  />
                </TableCell>
                <TableCell className={'text-right'}>
                  <RevenueCell revenue={row.revenue} />
                </TableCell>
                <TableCell>
                  <NoteCell
                    publishId={row.videoId}
                    title={row.title}
                    note={row.analyticsNote}
                    updatedAt={row.analyticsNoteUpdatedAt}
                    canEdit={row.canEditNote}
                    onSaved={(saved) => onNoteSaved(row.videoId, saved)}
                    onPermissionLost={onNotePermissionLost}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHead({
  column,
  label,
  view,
  onSort,
  className,
}: {
  column: VideoLogSortColumn;
  label: string;
  view: VideoLogView;
  onSort: (column: VideoLogSortColumn) => void;
  className?: string;
}) {
  const active = view.orderBy === column;
  const ascending = active && view.orderDirection === 'asc';
  const Icon = !active ? ChevronsUpDown : ascending ? ArrowUp : ArrowDown;

  return (
    <TableHead
      className={className}
      aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type={'button'}
        className={'flex items-center gap-1 font-medium'}
        onClick={() => onSort(column)}
        data-test={`video-log-sort-${column}`}
      >
        {label}
        <Icon className={'h-3.5 w-3.5 opacity-60'} />
      </button>
    </TableHead>
  );
}
