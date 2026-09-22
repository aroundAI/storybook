---
spec_id: FILM-807
status: 🟡 PARTIAL
audited: 2026-09-23
---

# FILM-807: Performance Chart

## Metadata
- **Phase:** 8 - Analytics
- **Priority:** P2 (Post-MVP)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-805 (Analytics Dashboard)
- **Blocks:** None
- **Status:** 🟡 PARTIAL (audit 2026-09-23; was ✅ DONE)

---

## Context

The Performance Chart visualizes metrics over time, allowing creators to identify trends, spikes from viral content, and the impact of posting schedules. It supports multiple metrics, platform filtering, and various time granularities.

---

## Specification

### Requirements

1. **Time Series Visualization**: Line/area chart for metrics over time
2. **Multi-Metric Support**: Compare views, likes, comments on same chart
3. **Platform Breakdown**: Color-coded lines per platform
4. **Interactive**: Hover for detailed tooltips, click for drill-down
5. **Zoom/Pan**: Focus on specific date ranges
6. **Responsive**: Works on mobile screens
7. **Export**: Download chart as PNG/SVG

### Chart Component

```typescript
// packages/features/content-analytics/src/components/performance-chart.tsx

'use client';

import { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@kit/ui/toggle-group';
import { Button } from '@kit/ui/button';
import { Download } from 'lucide-react';
import { formatNumber, formatDate } from '../lib/format';

interface PerformanceChartProps {
  data: DailyMetric[];
  platforms: string[];
  height?: number;
}

type MetricType = 'views' | 'likes' | 'comments' | 'shares';
type ChartType = 'line' | 'area' | 'stacked';

const PLATFORM_COLORS: Record<string, string> = {
  youtube: '#FF0000',
  tiktok: '#000000',
  instagram: '#E4405F',
  facebook: '#1877F2',
  aggregate: '#6366F1',
};

const METRIC_LABELS: Record<MetricType, string> = {
  views: 'Views',
  likes: 'Likes',
  comments: 'Comments',
  shares: 'Shares',
};

export function PerformanceChart({
  data,
  platforms,
  height = 350,
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

    // With platform breakdown, restructure data
    return data.map((d) => {
      const point: Record<string, any> = { date: d.date };
      platforms.forEach((platform) => {
        point[platform] = d.byPlatform?.[platform]?.[selectedMetric] || 0;
      });
      return point;
    });
  }, [data, selectedMetric, showPlatformBreakdown, platforms]);

  const renderChart = () => {
    const commonProps = {
      data: chartData,
      margin: { top: 5, right: 30, left: 20, bottom: 5 },
    };

    if (chartType === 'area' || chartType === 'stacked') {
      return (
        <AreaChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="date"
            tickFormatter={(date) => formatDate(new Date(date), 'MMM d')}
            className="text-xs"
          />
          <YAxis
            tickFormatter={formatNumber}
            className="text-xs"
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />

          {showPlatformBreakdown ? (
            platforms.map((platform) => (
              <Area
                key={platform}
                type="monotone"
                dataKey={platform}
                stackId={chartType === 'stacked' ? '1' : undefined}
                stroke={PLATFORM_COLORS[platform]}
                fill={PLATFORM_COLORS[platform]}
                fillOpacity={0.3}
                name={platform.charAt(0).toUpperCase() + platform.slice(1)}
              />
            ))
          ) : (
            <Area
              type="monotone"
              dataKey="value"
              stroke={PLATFORM_COLORS.aggregate}
              fill={PLATFORM_COLORS.aggregate}
              fillOpacity={0.3}
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
          tickFormatter={(date) => formatDate(new Date(date), 'MMM d')}
          className="text-xs"
        />
        <YAxis
          tickFormatter={formatNumber}
          className="text-xs"
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend />

        {showPlatformBreakdown ? (
          platforms.map((platform) => (
            <Line
              key={platform}
              type="monotone"
              dataKey={platform}
              stroke={PLATFORM_COLORS[platform]}
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
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* Metric Selector */}
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

          {/* Chart Type */}
          <ToggleGroup
            type="single"
            value={chartType}
            onValueChange={(v) => v && setChartType(v as ChartType)}
          >
            <ToggleGroupItem value="line" size="sm">Line</ToggleGroupItem>
            <ToggleGroupItem value="area" size="sm">Area</ToggleGroupItem>
            <ToggleGroupItem value="stacked" size="sm">Stacked</ToggleGroupItem>
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
          <Button variant="ghost" size="icon" onClick={handleExport}>
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={height}>
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-popover border rounded-lg shadow-lg p-3">
      <p className="font-medium mb-2">
        {formatDate(new Date(label), 'MMMM d, yyyy')}
      </p>
      {payload.map((entry: any, index: number) => (
        <div key={index} className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-sm text-muted-foreground">
              {entry.name}
            </span>
          </div>
          <span className="font-medium tabular-nums">
            {formatNumber(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function handleExport() {
  // Get SVG element and convert to PNG
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
    link.download = `analytics-${format(new Date(), 'yyyy-MM-dd')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
}
```

### Mini Sparkline Component

```typescript
// For compact display in tables or cards

import { Sparklines, SparklinesLine, SparklinesSpots } from 'react-sparklines';

interface SparklineChartProps {
  data: number[];
  color?: string;
  height?: number;
}

export function SparklineChart({
  data,
  color = '#6366F1',
  height = 30,
}: SparklineChartProps) {
  return (
    <Sparklines data={data} width={100} height={height}>
      <SparklinesLine color={color} />
      <SparklinesSpots size={2} style={{ fill: color }} />
    </Sparklines>
  );
}
```

### Comparison Chart

```typescript
// For comparing two time periods

interface ComparisonChartProps {
  currentData: DailyMetric[];
  previousData: DailyMetric[];
  metric: MetricType;
}

export function ComparisonChart({
  currentData,
  previousData,
  metric,
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
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="index" tickFormatter={(v) => `Day ${v}`} />
        <YAxis tickFormatter={formatNumber} />
        <Tooltip />
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
```

### Types

```typescript
// packages/features/content-analytics/src/types.ts

export interface DailyMetric {
  date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  byPlatform?: Record<string, {
    views: number;
    likes: number;
    comments: number;
    shares: number;
  }>;
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/content-analytics/src/components/performance-chart.tsx` |
| CREATE | `packages/features/content-analytics/src/components/sparkline-chart.tsx` |
| CREATE | `packages/features/content-analytics/src/components/comparison-chart.tsx` |

---

## Acceptance Criteria

- [x] Renders time series chart with daily data points
- [x] Supports line, area, and stacked area chart types
- [x] Metric selector switches between views/likes/comments/shares
- [x] Platform breakdown shows colored lines per platform
- [x] Aggregate view shows combined metrics
- [x] Hover tooltip shows date and values
- [x] Export chart as PNG
- [ ] Responsive on mobile screens — *audit: unverified* — needs a phone-width screenshot; the chart is `ResponsiveContainer` 100%, but the 7-toggle control group does not wrap (`packages/features/content-analytics/src/components/performance-chart.tsx:227`)
- [ ] Legend clickable to hide/show series — *audit: no longer true* — a bare recharts `<Legend />` with no click handler or hidden-series state, since 2b20331f (`performance-chart.tsx:157`)
- [x] Y-axis uses abbreviated numbers (K, M)

---

## Test Plan

### Unit Tests
- [ ] Test data transformation for chart format — *audit: not met* — no test found
- [ ] Test platform color mapping — *audit: not met* — no test found

### Visual Tests
- [ ] Chart renders correctly with sample data — *audit: not met* — no test found
- [ ] Responsive at different widths — *audit: not met* — no test found
- [ ] Export generates valid image — *audit: not met* — no test found

---

## Performance Considerations

- Use `useMemo` for data transformations
- Limit data points for large date ranges
- Consider downsampling for year view (weekly/monthly aggregates)

---

## Dependencies

- `recharts` - Charting library
- `react-sparklines` - Mini sparkline charts (optional)

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Legend clickable to hide/show series | `performance-chart.tsx:157,196` render a bare recharts `<Legend />`; recharts does not toggle series by itself and nothing tracks hidden series. True since the chart shipped (2b20331f) | unassigned |
