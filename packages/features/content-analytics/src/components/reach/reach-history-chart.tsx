'use client';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@kit/ui/chart';

interface ReachSeries {
  key: string;
  label: string;
  points: Array<{ asOf: string; value: number | null }>;
}

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
];

/**
 * Each channel's recorded window figure, day by day: one line per channel,
 * never a summed line. A day with no record is a gap, not a zero.
 */
export function ReachHistoryChart({
  window,
  series,
}: {
  window: number;
  series: ReachSeries[];
}) {
  if (series.length === 0) return null;

  const days = [
    ...new Set(series.flatMap((s) => s.points.map((p) => p.asOf))),
  ].sort();
  const rows = days.map((asOf) => ({
    asOf,
    ...Object.fromEntries(
      series.map((s) => [
        s.key,
        s.points.find((point) => point.asOf === asOf)?.value ?? null,
      ]),
    ),
  }));

  const config = Object.fromEntries(
    series.map((s, index) => [
      s.key,
      { label: s.label, color: COLORS[index % COLORS.length] },
    ]),
  );

  return (
    <Card data-test="reach-history">
      <CardHeader>
        <CardTitle className="text-base">
          {window}-day accounts reached, as recorded each day
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="h-64 w-full">
          <LineChart data={rows}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="asOf" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={48} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={`var(--color-${s.key})`}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
