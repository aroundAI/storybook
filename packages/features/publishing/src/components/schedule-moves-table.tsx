'use client';

import { ArrowRight } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';

import { PLATFORM_NAMES, isPlatform } from '../lib/platforms';

/** A post a change of time moves: what the services return */
export interface ScheduleMove {
  publishId: string;
  episode: string;
  platform: string;
  kind: 'long' | 'short';
  title: string | null;
  from: string;
  to: string;
}

export interface ScheduleNotMoved {
  publishId: string;
  reason: string;
}

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function formatMoveTime(at: string, timeZone = browserTimeZone()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(at));
}

/**
 * FILM-2213. What a change of time, a re-plan or a save of posting rules
 * moves, from → to in the viewer's timezone, and what stays and why
 */
export function ScheduleMovesTable(props: {
  moves: ScheduleMove[];
  notMoved?: ScheduleNotMoved[];
}) {
  return (
    <div className="space-y-2">
      {props.moves.length > 0 && (
        <div className="max-h-72 overflow-y-auto rounded-md border">
          <Table data-test="schedule-moves">
            <TableHeader>
              <TableRow>
                <TableHead>Episode</TableHead>
                <TableHead>Post</TableHead>
                <TableHead>From</TableHead>
                <TableHead />
                <TableHead>To</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.moves.map((move) => (
                <TableRow
                  key={move.publishId}
                  data-test="schedule-move"
                  data-publish-id={move.publishId}
                  data-to={move.to}
                >
                  <TableCell className="whitespace-nowrap">
                    {move.episode}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {isPlatform(move.platform)
                      ? PLATFORM_NAMES[move.platform]
                      : move.platform}{' '}
                    {move.kind === 'short' ? 'Short' : 'long video'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatMoveTime(move.from)}
                  </TableCell>
                  <TableCell className="px-0">
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatMoveTime(move.to)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {props.notMoved && props.notMoved.length > 0 && (
        <ul
          className="space-y-1 text-sm text-destructive"
          data-test="schedule-not-moved"
        >
          {props.notMoved.map((item) => (
            <li key={item.publishId}>{item.reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
