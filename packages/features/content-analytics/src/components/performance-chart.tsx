'use client';

import React from 'react';
import { useCallback, useMemo, useState } from 'react';

import { Download } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@kit/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@kit/ui/toggle-group';

import { formatDate, formatNumber } from '../lib/format';
import { PLATFORM_COLORS } from '../lib/platform-colors';
import {
  type ViewDefinitionMark,
  isoDay,
} from '../lib/view-definition-marks';
import type { DailyMetric } from '../types';

type MetricType = 'views' | 'likes' | 'comments' | 'shares';
type ChartType = 'line' | 'area' | 'stacked';

const METRIC_LABELS: Record<MetricType, string> = {
  views: 'Views',
  likes: 'Likes',
  comments: 'Comments',
  shares: 'Shares',
};

interface PerformanceChartProps {
  data: DailyMetric[];
  platforms: string[];
  height?: number;
  /**
   * Where the range crosses a change in what counts as a view (FILM-1722).
   * Drawn as a dashed line on the day, so a step there reads as the count
   * changing; the card beside the chart says what changed.
   */
  marks?: readonly ViewDefinitionMark[];
}

export const PerformanceChart = React.memo(function PerformanceChart({
  data,
  platforms,
  height = 350,
  marks = [],
}: PerformanceChartProps) {
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('views');
  const [chartType, setChartType] = useState<ChartType>('area');
  const [showPlatformBreakdown, setShowPlatformBreakdown] = useState(false);

  const chartData = useMemo(() => {
    if (!showPlatformBreakdown) {
      return data.map((d) => ({
        date: d.date,
        value: d[selectedMetric],
      }));
    }

    return data.map((d) => {
      const point: Record<string, string | number> = { date: d.date };
      platforms.forEach((platform) => {
        point[platform] = d.byPlatform?.[platform]?.[selectedMetric] || 0;
      });
      return point;
    });
  }, [data, selectedMetric, showPlatformBreakdown, platforms]);

  // A category axis draws a line only at a value it holds: the first day on
  // or after the change. A change before the first point is not drawn.
  const markLines = useMemo(
    () =>
      marks.flatMap((mark) => {
        const point = data.find((d) => isoDay(d.date) >= mark.date);

        return point ? [{ key: `${mark.platform}:${mark.date}`, x: point.date }] : [];
      }),
    [marks, data],
  );

  const referenceLines = markLines.map(({ key, x }) => (
    <ReferenceLine
      key={key}
      x={x}
      stroke="currentColor"
      strokeDasharray="4 4"
      className="text-muted-foreground"
      ifOverflow="extendDomain"
    />
  ));

  const handleExport = useCallback(() => {
    const svg = document.querySelector('.recharts-wrapper svg');
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);

      const link = document.createElement('a');
      link.download = `analytics-${formatDate(new Date(), 'yyyy-MM-dd')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
  }, []);

  const renderChart = () => {
    const commonProps = {
      data: chartData,
      margin: { top: 5, right: 30, left: 20, bottom: 5 },
    };

    if (chartType === 'area' || chartType === 'stacked') {
      return (
        <AreaChart {...commonProps}>
          <defs>
            <linearGradient id="fillAggregate" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor={PLATFORM_COLORS.aggregate}
                stopOpacity={0.8}
              />
              <stop
                offset="95%"
                stopColor={PLATFORM_COLORS.aggregate}
                stopOpacity={0.1}
              />
            </linearGradient>
            {platforms.map((platform) => (
              <linearGradient
                key={platform}
                id={`fill-${platform}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor={
                    PLATFORM_COLORS[platform] || PLATFORM_COLORS.aggregate
                  }
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor={
                    PLATFORM_COLORS[platform] || PLATFORM_COLORS.aggregate
                  }
                  stopOpacity={0.1}
                />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} className="stroke-muted" />
          <XAxis
            dataKey="date"
            tickFormatter={(date: string) =>
              formatDate(new Date(date), 'MMM d')
            }
            className="text-xs"
          />
          <YAxis tickFormatter={formatNumber} className="text-xs" />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {referenceLines}

          {showPlatformBreakdown ? (
            platforms.map((platform) => (
              <Area
                key={platform}
                type="natural"
                dataKey={platform}
                stackId={chartType === 'stacked' ? '1' : undefined}
                stroke={PLATFORM_COLORS[platform] || PLATFORM_COLORS.aggregate}
                fill={`url(#fill-${platform})`}
                fillOpacity={0.4}
                name={platform.charAt(0).toUpperCase() + platform.slice(1)}
              />
            ))
          ) : (
            <Area
              type="natural"
              dataKey="value"
              stroke={PLATFORM_COLORS.aggregate}
              fill="url(#fillAggregate)"
              fillOpacity={0.4}
              name={METRIC_LABELS[selectedMetric]}
            />
          )}
        </AreaChart>
      );
    }

    return (
      <LineChart {...commonProps}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          tickFormatter={(date: string) => formatDate(new Date(date), 'MMM d')}
          className="text-xs"
        />
        <YAxis tickFormatter={formatNumber} className="text-xs" />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        {referenceLines}

        {showPlatformBreakdown ? (
          platforms.map((platform) => (
            <Line
              key={platform}
              type="monotone"
              dataKey={platform}
              stroke={PLATFORM_COLORS[platform] || PLATFORM_COLORS.aggregate}
              strokeWidth={2}
              dot={false}
              name={platform.charAt(0).toUpperCase() + platform.slice(1)}
            />
          ))
        ) : (
          <Line
            type="monotone"
            dataKey="value"
            stroke={PLATFORM_COLORS.aggregate}
            strokeWidth={2}
            dot={false}
            name={METRIC_LABELS[selectedMetric]}
          />
        )}
      </LineChart>
    );
  };

  return (
    <div className="space-y-4" data-test="performance-chart">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <ToggleGroup
            type="single"
            value={selectedMetric}
            onValueChange={(v) => v && setSelectedMetric(v as MetricType)}
          >
            {Object.entries(METRIC_LABELS).map(([key, label]) => (
              <ToggleGroupItem key={key} value={key} size="sm">
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <ToggleGroup
            type="single"
            value={chartType}
            onValueChange={(v) => v && setChartType(v as ChartType)}
          >
            <ToggleGroupItem value="line" size="sm">
              Line
            </ToggleGroupItem>
            <ToggleGroupItem value="area" size="sm">
              Area
            </ToggleGroupItem>
            <ToggleGroupItem value="stacked" size="sm">
              Stacked
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPlatformBreakdown(!showPlatformBreakdown)}
          >
            {showPlatformBreakdown ? 'Aggregate' : 'By Platform'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleExport}
            aria-label="Export chart as PNG"
            data-test="performance-chart-export"
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
});

interface TooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border bg-popover p-3 shadow-lg">
      <p className="mb-2 font-medium">
        {label ? formatDate(new Date(label), 'MMMM d, yyyy') : ''}
      </p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-sm text-muted-foreground">{entry.name}</span>
          </div>
          <span className="font-medium tabular-nums">
            {formatNumber(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
