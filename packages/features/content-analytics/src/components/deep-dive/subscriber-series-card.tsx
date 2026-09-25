'use client';

import { useMemo, useState } from 'react';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import type {
  ConnectionSubscriberSeries,
  SubscriberSource,
} from '@kit/clickhouse';
import { ChartContainer, ChartTooltip } from '@kit/ui/chart';
import { Skeleton } from '@kit/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@kit/ui/toggle-group';

import {
  type ChartLine,
  type ChartRow,
  drawnRoundingError,
  isolatedKey,
  measuredKey,
  sourceKey,
  toChartData,
} from '../../lib/subscriber-chart-data';
import {
  SUBSCRIBER_SOURCE_LABEL,
  describeRounding,
  formatSubscriberDay,
  roundingErrorOf,
} from '../../lib/subscriber-disclosure';
import { sumByPlatform } from '../../lib/subscriber-series-sum';
import {
  channelStatus,
  describeChannelStatus,
  describeTotal,
  describeUntrackedChannels,
  platformLabel,
} from '../../lib/subscriber-total-note';
import type { ChannelRef } from '../../server/channels';

interface SubscriberSeriesCardProps {
  series: ConnectionSubscriberSeries[];
  /** The project's channels: names, platforms, and which are still active. */
  channels: ChannelRef[];
}

type View = 'per-channel' | 'total';

/**
 * The absolute subscriber curve (FILM-1607, surfaced by FILM-1617).
 *
 * One line per channel by default. The total is offered only under the
 * every-channel rule in `sumSubscriberSeries`, and says where it starts.
 *
 * Every point's source is visible, not just the curve: a measured snapshot, a
 * day reconstructed from daily movement, and a day held to a rounded figure
 * are different claims about the same number.
 */
export function SubscriberSeriesCard({
  series,
  channels,
}: SubscriberSeriesCardProps) {
  const channelNames = useMemo(
    () => Object.fromEntries(channels.map((c) => [c.connectionId, c.name])),
    [channels],
  );

  const [view, setView] = useState<View>('per-channel');

  const channelById = useMemo(
    () => new Map(channels.map((c) => [c.connectionId, c])),
    [channels],
  );

  // A platform no snapshot is ever taken for is explained once, apart from
  // channels whose count is missing: the reasons differ.
  const isTracked = (s: ConnectionSubscriberSeries) =>
    channelStatus(s, channelById.get(s.connectionId)).kind !== 'untracked';

  const tracked = series.filter(isTracked);
  const untracked = series.filter((s) => !isTracked(s));
  const withData = tracked.filter((s) => s.points.length > 0);
  const withoutData = tracked.filter((s) => s.points.length === 0);
  const canTotal = tracked.length > 1;

  const statusById = Object.fromEntries(
    series.map((s) => [
      s.connectionId,
      channelStatus(s, channelById.get(s.connectionId)),
    ]),
  );

  const statusOf = (s: ConnectionSubscriberSeries) =>
    describeChannelStatus(statusById[s.connectionId]!);

  // One per platform: a YouTube subscriber and a TikTok follower are not
  // the same unit, and adding them counts a person on both twice.
  const totals = useMemo(
    () => sumByPlatform(series, channels),
    [series, channels],
  );

  const showingTotal = canTotal && view === 'total';

  const lines = useMemo(
    () =>
      showingTotal
        ? totals
            .filter((t) => t.points.length > 0)
            .map((t) => ({
              key: `total-${t.platform}`,
              name: `${platformLabel(t.platform)} total`,
              points: t.points,
            }))
        : withData.map((s) => ({
            key: s.connectionId,
            name: channelNames[s.connectionId] ?? 'Channel',
            points: s.points,
          })),
    [showingTotal, totals, withData, channelNames],
  );

  const { rows, config } = useMemo(() => toChartData(lines), [lines]);

  if (withData.length === 0) {
    return (
      <div
        className={'flex flex-col gap-1 text-sm text-muted-foreground'}
        data-test={'subscriber-series-empty'}
      >
        {series.length === 0 ? (
          <p>No channel publishes in this project yet.</p>
        ) : series.length === 1 ? (
          <p>{statusOf(series[0]!)}</p>
        ) : (
          <ul>
            {series.map((s) => (
              <li key={s.connectionId}>
                {channelNames[s.connectionId] ?? 'A channel'}: {statusOf(s)}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // Per channel, each line is off by at most its own rounding error; a
  // total by all of its channels' at once.
  const rounding = describeRounding(
    showingTotal
      ? drawnRoundingError(totals)
      : Math.max(...withData.map((s) => roundingErrorOf(s.roundingStep))),
  );

  return (
    <div className={'flex flex-col gap-3'} data-test={'subscriber-series'}>
      {canTotal ? (
        <ToggleGroup
          type={'single'}
          size={'sm'}
          variant={'outline'}
          value={view}
          onValueChange={(next) => next && setView(next as View)}
          className={'self-start'}
        >
          <ToggleGroupItem
            value={'per-channel'}
            data-test={'subscriber-series-per-channel'}
          >
            Per channel
          </ToggleGroupItem>
          <ToggleGroupItem
            value={'total'}
            data-test={'subscriber-series-total'}
          >
            Total
          </ToggleGroupItem>
        </ToggleGroup>
      ) : null}

      {showingTotal ? (
        <ul
          className={'flex flex-col gap-1 text-xs text-muted-foreground'}
          data-test={'subscriber-series-total-note'}
        >
          {totals.map((t) => (
            <li key={t.platform}>
              {describeTotal(t, channelNames, statusById)}
            </li>
          ))}
        </ul>
      ) : null}

      {lines.length > 0 ? (
        <ChartContainer config={config} className={'h-[260px] w-full'}>
          <LineChart
            data={rows}
            margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey={'date'}
              tickFormatter={formatSubscriberDay}
              minTickGap={48}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              width={64}
              tickFormatter={(value: number) => value.toLocaleString()}
              tickLine={false}
              axisLine={false}
              domain={['auto', 'auto']}
            />
            <ChartTooltip
              content={<SubscriberTooltip lines={lines} />}
              cursor={false}
            />
            {/*
              Two strokes per line. Dashed through every day; solid through
              measured days, broken wherever a day was reconstructed from
              movement alone — so a capture gap shows as dashed.
            */}
            {lines.map((line) => {
              const between = isSnapshotOnly(line);

              return (
                <Line
                  key={`${line.key}-all`}
                  dataKey={line.key}
                  name={line.name}
                  // Between snapshots the line *is* a straight line between
                  // two counts (KB-114); a curve would imply movement.
                  type={between ? 'linear' : 'monotone'}
                  stroke={`var(--color-${line.key})`}
                  strokeWidth={1.5}
                  strokeDasharray={between ? '2 4' : '4 4'}
                  strokeOpacity={between ? 0.45 : 0.7}
                  isAnimationActive={false}
                  dot={false}
                  activeDot={false}
                />
              );
            })}
            {lines.map((line) =>
              isSnapshotOnly(line) ? (
                // No solid stroke at all: nothing between two counts was
                // measured, even on consecutive days. A point per count.
                <Line
                  key={`${line.key}-measured`}
                  dataKey={measuredKey(line.key)}
                  name={line.name}
                  stroke={'transparent'}
                  connectNulls={false}
                  isAnimationActive={false}
                  dot={<SnapshotDot lineKey={line.key} />}
                  activeDot={false}
                />
              ) : (
                <Line
                  key={`${line.key}-measured`}
                  dataKey={measuredKey(line.key)}
                  name={line.name}
                  type={'monotone'}
                  stroke={`var(--color-${line.key})`}
                  strokeWidth={2}
                  connectNulls={false}
                  isAnimationActive={false}
                  dot={<PointDot lineKey={line.key} />}
                  activeDot={false}
                />
              ),
            )}
          </LineChart>
        </ChartContainer>
      ) : null}

      {lines.length > 0 ? (
        <ul
          className={'flex flex-wrap gap-x-4 gap-y-1 text-xs'}
          data-test={'subscriber-series-lines'}
        >
          {lines.map((line) => (
            <li key={line.key} className={'flex items-center gap-1.5'}>
              <span
                className={'inline-block h-0.5 w-3'}
                // A global chart token, not the container-scoped
                // --color-<key>, which only exists inside ChartContainer.
                style={{ backgroundColor: config[line.key]?.color }}
              />
              {line.name}
            </li>
          ))}
        </ul>
      ) : null}

      {lines.length > 0 ? (
        <SourceLegend snapshotOnly={lines.some(isSnapshotOnly)} />
      ) : null}

      {withoutData.length > 0 && !showingTotal ? (
        <ul
          className={'text-xs text-muted-foreground'}
          data-test={'subscriber-series-missing'}
        >
          {withoutData.map((s) => (
            <li key={s.connectionId}>
              {channelNames[s.connectionId] ?? 'A channel'}: {statusOf(s)}
            </li>
          ))}
        </ul>
      ) : null}

      {untracked.length > 0 ? (
        <p
          className={'text-xs text-muted-foreground'}
          data-test={'subscriber-series-untracked'}
        >
          {describeUntrackedChannels(
            untracked.map((s) => channelNames[s.connectionId] ?? 'A channel'),
          )}
        </p>
      ) : null}

      {rounding ? (
        <p
          className={'text-xs text-muted-foreground'}
          data-test={'subscriber-seed-disclosure'}
        >
          {rounding}
        </p>
      ) : null}

      <p className={'text-xs text-muted-foreground'}>
        A curve starts at a channel’s first snapshot and reaches earlier only as
        far as its daily movement does.
      </p>
    </div>
  );
}

/**
 * Marks only the exceptions. Snapshots are daily, so marking every measured
 * day buried the line; the solid/dashed stroke carries measured vs
 * reconstructed and the tooltip names every day's source. Two cases need a
 * mark of their own:
 *
 * - a clamped day — the platform's rounded figure disagreed with the daily
 *   movement — as a square, not a colour: the first chart colour is itself
 *   orange in this theme, so an amber dot was lost on that channel's line;
 * - a measured day with none either side, which a stroke cannot draw — a
 *   channel's first snapshot would otherwise be invisible.
 */
function PointDot(props: {
  cx?: number;
  cy?: number;
  stroke?: string;
  payload?: ChartRow;
  lineKey: string;
}) {
  const { cx, cy, stroke, payload, lineKey } = props;

  if (cx === undefined || cy === undefined || !payload) return null;

  if (payload[sourceKey(lineKey)] === 'clamped') {
    return (
      <rect
        x={cx - 3.5}
        y={cy - 3.5}
        width={7}
        height={7}
        fill={'var(--background)'}
        stroke={'var(--foreground)'}
        strokeWidth={1.5}
      />
    );
  }

  if (payload[isolatedKey(lineKey)] === true) {
    return <circle cx={cx} cy={cy} r={3} fill={stroke} stroke={stroke} />;
  }

  return null;
}

/**
 * A line with any day reconstructed between snapshots: its channel reports no
 * daily gains and losses (TikTok, Instagram; KB-114). Decided 2026-09-25:
 * draw straight lines between the counts actually recorded, mark each count,
 * and never present a day between them as a measured movement.
 */
function isSnapshotOnly(line: ChartLine): boolean {
  return line.points.some((p) => p.source === 'between_snapshots');
}

/**
 * One recorded follower count on a snapshot-only line. Carries its date and
 * count so the figures on screen can be read back and checked against what
 * was recorded.
 */
function SnapshotDot(props: {
  cx?: number;
  cy?: number;
  payload?: ChartRow;
  value?: number | null;
  lineKey: string;
}) {
  const { cx, cy, payload, value, lineKey } = props;

  if (cx === undefined || cy === undefined || !payload) return null;
  if (typeof value !== 'number') return null;

  return (
    <circle
      cx={cx}
      cy={cy}
      r={3.5}
      fill={`var(--color-${lineKey})`}
      stroke={'var(--background)'}
      strokeWidth={1}
      data-test={'subscriber-snapshot-point'}
      data-date={payload.date}
      data-count={value}
    />
  );
}

function SourceLegend({ snapshotOnly }: { snapshotOnly: boolean }) {
  return (
    <ul
      className={'flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'}
      data-test={'subscriber-source-legend'}
    >
      {snapshotOnly ? (
        <>
          <li
            className={'flex items-center gap-1.5'}
            data-test={'subscriber-legend-snapshot-point'}
          >
            <span
              className={'inline-block size-2 rounded-full bg-foreground'}
            />
            A follower count recorded that day
          </li>
          <li
            className={'flex items-center gap-1.5'}
            data-test={'subscriber-legend-between-snapshots'}
          >
            <span
              className={
                'inline-block w-4 border-t border-dotted border-foreground opacity-60'
              }
            />
            Lighter dotted line — reconstructed from follower snapshots; this
            platform reports no daily gains or losses
          </li>
        </>
      ) : null}
      <li className={'flex items-center gap-1.5'}>
        <span className={'inline-block h-0.5 w-4 bg-foreground'} />
        Solid — a snapshot that day
      </li>
      <li className={'flex items-center gap-1.5'}>
        <span
          className={
            'inline-block w-4 border-t border-dashed border-foreground'
          }
        />
        Dashed — no snapshot, reconstructed from daily movement
      </li>
      <li className={'flex items-center gap-1.5'}>
        <span
          className={
            'inline-block size-2 border border-foreground bg-background'
          }
        />
        Held to the edge of the platform’s rounded figure
      </li>
      <li className={'flex items-center gap-1.5'}>
        <span className={'inline-block size-2 rounded-full bg-foreground'} />A
        measured day with none either side
      </li>
    </ul>
  );
}

function SubscriberTooltip({
  active,
  payload,
  lines,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
  lines: ChartLine[];
}) {
  const row = payload?.[0]?.payload;

  if (!active || !row) return null;

  return (
    <div
      className={
        'grid min-w-48 gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl'
      }
    >
      <span className={'font-medium'}>{formatSubscriberDay(row.date)}</span>
      {lines.map((line) => {
        const level = row[line.key];
        const source = row[sourceKey(line.key)] as SubscriberSource | undefined;

        if (typeof level !== 'number' || !source) return null;

        return (
          <div key={line.key} className={'flex flex-col'}>
            <span className={'flex justify-between gap-4'}>
              <span>{line.name}</span>
              <span className={'font-mono tabular-nums'}>
                {level.toLocaleString()}
              </span>
            </span>
            <span className={'text-muted-foreground'}>
              {SUBSCRIBER_SOURCE_LABEL[source]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SubscriberSeriesCardSkeleton() {
  return <Skeleton className={'h-[260px] w-full'} />;
}
