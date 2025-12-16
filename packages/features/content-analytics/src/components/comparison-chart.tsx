'use client';

import { useMemo } from 'react';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatNumber } from '../lib/format';
import type { DailyMetric } from '../types';

type MetricType = 'views' | 'likes' | 'comments' | 'shares';

interface ComparisonChartProps {
  currentData: DailyMetric[];
  previousData: DailyMetric[];
  metric: MetricType;
  height?: number;
}

export function ComparisonChart({
  currentData,
  previousData,
  metric,
  height = 200,
}: ComparisonChartProps) {
  const chartData = useMemo(() => {
    const maxLength = Math.max(currentData.length, previousData.length);
    const result = [];

    for (let i = 0; i < maxLength; i++) {
      result.push({
        index: i + 1,
        current: currentData[i]?.[metric] || 0,
        previous: previousData[i]?.[metric] || 0,
      });
    }

    return result;
  }, [currentData, previousData, metric]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        data={chartData}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="index"
          tickFormatter={(v: number) => `Day ${v}`}
          className="text-xs"
        />
        <YAxis tickFormatter={formatNumber} className="text-xs" />
        <Tooltip content={<ComparisonTooltip />} />
        <Legend />
        <Area
          type="monotone"
          dataKey="current"
          stroke="#6366F1"
          fill="#6366F1"
          fillOpacity={0.3}
          name="Current Period"
        />
        <Area
          type="monotone"
          dataKey="previous"
          stroke="#94A3B8"
          fill="#94A3B8"
          fillOpacity={0.2}
          strokeDasharray="5 5"
          name="Previous Period"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  label?: number;
}

function ComparisonTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-popover rounded-lg border p-3 shadow-lg">
      <p className="mb-2 font-medium">Day {label}</p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground text-sm">{entry.name}</span>
          </div>
          <span className="font-medium tabular-nums">
            {formatNumber(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
