'use client';

import { useMemo, useState } from 'react';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import type {
  ConnectionSubscriberSeries,
  SubscriberSource,
} from '@kit/clickhouse';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@kit/ui/chart';
import { Skeleton } from '@kit/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@kit/ui/toggle-group';

import {
  NO_SUBSCRIBER_LEVEL,
  SUBSCRIBER_SOURCE_LABEL,
  describeRounding,
  formatSubscriberDay,
} from '../../lib/subscriber-disclosure';
import { sumSubscriberSeries } from '../../lib/subscriber-series-sum';

interface SubscriberSeriesCardProps {
  series: ConnectionSubscriberSeries[];
  /** Display name per connection id, from the channel list. */
  channelNames: Record<string, string>;
}

type View = 'per-channel' | 'total';

const TOTAL_KEY = 'total';

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
  channelNames,
}: SubscriberSeriesCardProps) {
  const [view, setView] = useState<View>('per-channel');

  const withData = series.filter((s) => s.points.length > 0);
  const withoutData = series.filter((s) => s.points.length === 0);
  const canTotal = series.length > 1;

  const total = useMemo(() => sumSubscriberSeries(series), [series]);

  const showingTotal = canTotal && view === 'total';

  const lines = useMemo(
    () =>
      showingTotal
        ? total.points.length > 0
          ? [{ key: TOTAL_KEY, name: 'All channels', points: total.points }]
          : []
        : withData.map((s) => ({
            key: s.connectionId,
            name: channelNames[s.connectionId] ?? 'Channel',
            points: s.points,
          })),
    [showingTotal, total.points, withData, channelNames],
  );

  const { rows, config } = useMemo(() => toChartData(lines), [lines]);

  if (withData.length === 0) {
    return (
      <p
        className={'text-muted-foreground text-sm'}
        data-test={'subscriber-series-empty'}
      >
        {series.length === 0
          ? 'No channel publishes in this project yet.'
          : NO_SUBSCRIBER_LEVEL}
      </p>
    );
  }

  const rounding = describeRounding(
    Math.max(...withData.map((s) => s.roundingStep)),
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
        <p
          className={'text-muted-foreground text-xs'}
          data-test={'subscriber-series-total-note'}
        >
          {total.startsOn
            ? `The total begins ${formatSubscriberDay(total.startsOn)}, the first day every channel has a level. Adding a channel before it has one would read as a jump in subscribers.`
            : `No total yet: ${total.excluded
                .map((id) => channelNames[id] ?? 'a channel')
                .join(
                  ', ',
                )} ${total.excluded.length === 1 ? 'has' : 'have'} no subscriber count.`}
        </p>
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
            {lines.map((line) => (
              <Line
                key={line.key}
                dataKey={line.key}
                name={line.name}
                type={'monotone'}
                stroke={`var(--color-${line.key})`}
                strokeWidth={2}
                isAnimationActive={false}
                dot={<SourceDot />}
                activeDot={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      ) : null}

      <SourceLegend />

      {withoutData.length > 0 && !showingTotal ? (
        <p
          className={'text-muted-foreground text-xs'}
          data-test={'subscriber-series-missing'}
        >
          {withoutData
            .map((s) => channelNames[s.connectionId] ?? 'A channel')
            .join(', ')}
          : {NO_SUBSCRIBER_LEVEL}
        </p>
      ) : null}

      {rounding ? (
        <p
          className={'text-muted-foreground text-xs'}
          data-test={'subscriber-seed-disclosure'}
        >
          {rounding}
        </p>
      ) : null}

      <p className={'text-muted-foreground text-xs'}>
        A curve starts at a channel’s first snapshot and reaches earlier only as
        far as its daily movement does.
      </p>
    </div>
  );
}

type ChartLine = {
  key: string;
  name: string;
  points: Array<{ date: string; level: number; source: SubscriberSource }>;
};

type ChartRow = { date: string } & Record<string, string | number>;

function sourceKey(lineKey: string) {
  return `${lineKey}__source`;
}

function toChartData(lines: ChartLine[]) {
  const byDate = new Map<string, ChartRow>();

  for (const line of lines) {
    for (const point of line.points) {
      const row = byDate.get(point.date) ?? { date: point.date };

      row[line.key] = point.level;
      row[sourceKey(line.key)] = point.source;
      byDate.set(point.date, row);
    }
  }

  const config: ChartConfig = Object.fromEntries(
    lines.map((line, index) => [
      line.key,
      { label: line.name, color: `var(--chart-${(index % 5) + 1})` },
    ]),
  );

  const rows = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

  return { rows, config };
}

/**
 * Sources are told apart by shape, never by colour alone: the line's colour
 * already identifies the channel.
 *
 * A marker only where the day is not a plain reconstruction: a daily dot
 * across a year would bury the line. The line itself is the reconstructed
 * days; the legend says so.
 */
function SourceDot(props: {
  cx?: number;
  cy?: number;
  dataKey?: string;
  payload?: ChartRow;
  stroke?: string;
}) {
  const { cx, cy, dataKey, payload, stroke } = props;

  if (cx === undefined || cy === undefined || !dataKey || !payload) {
    return null;
  }

  const source = payload[sourceKey(dataKey)] as SubscriberSource | undefined;

  if (source === 'snapshot') {
    return <circle cx={cx} cy={cy} r={3} fill={stroke} stroke={stroke} />;
  }

  if (source === 'constrained') {
    return (
      <circle
        cx={cx}
        cy={cy}
        r={3}
        fill={'var(--background)'}
        stroke={stroke}
        strokeWidth={1.5}
      />
    );
  }

  // A square, not a colour: the first chart colour is itself orange in this
  // theme, so an amber dot on that channel's line was indistinguishable.
  if (source === 'clamped') {
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

  return null;
}

function SourceLegend() {
  return (
    <ul
      className={'text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'}
      data-test={'subscriber-source-legend'}
    >
      <li className={'flex items-center gap-1.5'}>
        <span className={'bg-foreground inline-block size-2 rounded-full'} />
        Snapshot — measured
      </li>
      <li className={'flex items-center gap-1.5'}>
        <span
          className={
            'border-foreground inline-block size-2 rounded-full border'
          }
        />
        Reconstructed, within the platform’s rounded figure
      </li>
      <li className={'flex items-center gap-1.5'}>
        <span
          className={
            'border-foreground bg-background inline-block size-2 border'
          }
        />
        Held to the edge of the rounded figure
      </li>
      <li className={'flex items-center gap-1.5'}>
        <span className={'bg-foreground inline-block h-0.5 w-3'} />
        Line only — reconstructed from daily movement
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
        'bg-background grid min-w-48 gap-1 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl'
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
