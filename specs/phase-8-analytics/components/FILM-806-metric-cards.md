# FILM-806: Metric Cards

## Metadata
- **Phase:** 8 - Analytics
- **Priority:** P2 (Post-MVP)
- **Effort:** S (2-4 hours)
- **Dependencies:** FILM-805 (Analytics Dashboard)
- **Blocks:** None

---

## Context

Metric Cards display key performance indicators (KPIs) at a glance. They show current values, change percentages compared to previous period, and trend indicators. These cards provide the "at-a-glance" summary at the top of the analytics dashboard.

---

## Specification

### Requirements

1. **Key Metrics**: Views, Likes, Comments, Shares, Watch Time, Subscribers, Revenue
2. **Period Comparison**: Show % change from previous period
3. **Trend Indicators**: Up/down arrows with color coding
4. **Responsive Grid**: Adapt to screen size
5. **Loading States**: Skeleton animation during fetch
6. **Tooltips**: Explain metric meaning on hover

### Metric Card Component

```typescript
// packages/features/content-analytics/src/components/metric-cards.tsx

'use client';

import { Card, CardContent } from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@kit/ui/tooltip';
import { TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';
import { formatNumber, formatDuration, formatCurrency, formatPercent } from '../lib/format';

interface MetricCardsProps {
  data: AnalyticsTotals | null;
  previousData: AnalyticsTotals | null;
  isLoading: boolean;
}

export function MetricCards({ data, previousData, isLoading }: MetricCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const metrics: MetricConfig[] = [
    {
      key: 'views',
      label: 'Views',
      value: data?.views || 0,
      previousValue: previousData?.views || 0,
      formatter: formatNumber,
      description: 'Total video views across all platforms',
      icon: Eye,
    },
    {
      key: 'likes',
      label: 'Likes',
      value: data?.likes || 0,
      previousValue: previousData?.likes || 0,
      formatter: formatNumber,
      description: 'Total likes, hearts, and reactions',
      icon: Heart,
    },
    {
      key: 'comments',
      label: 'Comments',
      value: data?.comments || 0,
      previousValue: previousData?.comments || 0,
      formatter: formatNumber,
      description: 'Total comments and replies',
      icon: MessageCircle,
    },
    {
      key: 'shares',
      label: 'Shares',
      value: data?.shares || 0,
      previousValue: previousData?.shares || 0,
      formatter: formatNumber,
      description: 'Times content was shared or reposted',
      icon: Share2,
    },
    {
      key: 'watchTime',
      label: 'Watch Time',
      value: data?.watchTimeSeconds || 0,
      previousValue: previousData?.watchTimeSeconds || 0,
      formatter: formatDuration,
      description: 'Total time viewers spent watching',
      icon: Clock,
    },
    {
      key: 'subscribers',
      label: 'Subscribers',
      value: data?.subscribersGained || 0,
      previousValue: previousData?.subscribersGained || 0,
      formatter: formatNumber,
      description: 'New followers and subscribers gained',
      icon: UserPlus,
    },
    {
      key: 'revenue',
      label: 'Revenue',
      value: data?.revenueCents || 0,
      previousValue: previousData?.revenueCents || 0,
      formatter: (v) => formatCurrency(v / 100),
      description: 'Estimated ad revenue (YouTube only)',
      icon: DollarSign,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
      {metrics.map((metric) => (
        <MetricCard key={metric.key} metric={metric} />
      ))}
    </div>
  );
}

interface MetricConfig {
  key: string;
  label: string;
  value: number;
  previousValue: number;
  formatter: (value: number) => string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

function MetricCard({ metric }: { metric: MetricConfig }) {
  const { label, value, previousValue, formatter, description, icon: Icon } = metric;

  const change = calculateChange(value, previousValue);
  const TrendIcon = change.direction === 'up' ? TrendingUp
    : change.direction === 'down' ? TrendingDown
    : Minus;

  const trendColor = change.direction === 'up'
    ? 'text-green-600'
    : change.direction === 'down'
    ? 'text-red-600'
    : 'text-muted-foreground';

  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">
              {label}
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground">
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs text-sm">{description}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-bold tabular-nums">
            {formatter(value)}
          </span>
          <div className={`flex items-center gap-0.5 text-sm ${trendColor}`}>
            <TrendIcon className="h-3.5 w-3.5" />
            <span>{formatPercent(Math.abs(change.percentage))}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCardSkeleton() {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4 space-y-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-24" />
      </CardContent>
    </Card>
  );
}

interface ChangeResult {
  percentage: number;
  direction: 'up' | 'down' | 'neutral';
}

function calculateChange(current: number, previous: number): ChangeResult {
  if (previous === 0) {
    return {
      percentage: current > 0 ? 100 : 0,
      direction: current > 0 ? 'up' : 'neutral',
    };
  }

  const percentage = ((current - previous) / previous) * 100;

  return {
    percentage,
    direction: percentage > 1 ? 'up' : percentage < -1 ? 'down' : 'neutral',
  };
}
```

### Formatting Utilities

```typescript
// packages/features/content-analytics/src/lib/format.ts

/**
 * Formats large numbers with abbreviations (1.2K, 3.4M, etc.)
 */
export function formatNumber(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

/**
 * Formats seconds into human-readable duration
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours >= 1000) {
    return `${formatNumber(hours)}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Formats cents to currency string
 */
export function formatCurrency(dollars: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(dollars);
}

/**
 * Formats percentage with sign
 */
export function formatPercent(value: number): string {
  const formatted = Math.abs(value).toFixed(1);
  return `${formatted}%`;
}
```

### Compact Metric Card Variant

```typescript
// For use in smaller spaces or sidebars

interface CompactMetricProps {
  label: string;
  value: string | number;
  change?: number;
}

export function CompactMetric({ label, value, change }: CompactMetricProps) {
  const changeColor = change && change > 0 ? 'text-green-600' : change && change < 0 ? 'text-red-600' : '';

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-medium tabular-nums">{value}</span>
        {change !== undefined && (
          <span className={`text-xs ${changeColor}`}>
            {change >= 0 ? '+' : ''}{change.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}
```

### Types

```typescript
// packages/features/content-analytics/src/types.ts

export interface AnalyticsTotals {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchTimeSeconds: number;
  subscribersGained: number;
  revenueCents: number;
  contentCount: number;
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/content-analytics/src/components/metric-cards.tsx` |
| CREATE | `packages/features/content-analytics/src/lib/format.ts` |
| CREATE | `packages/features/content-analytics/src/types.ts` |

---

## Acceptance Criteria

- [ ] Displays 7 key metrics in responsive grid
- [ ] Shows formatted values (K, M, B abbreviations)
- [ ] Shows percentage change from previous period
- [ ] Shows trend indicator (up/down/neutral)
- [ ] Correct color coding (green up, red down)
- [ ] Tooltip explains each metric
- [ ] Loading skeleton during data fetch
- [ ] Watch time formatted as duration
- [ ] Revenue formatted as currency
- [ ] Tabular numbers for alignment

---

## Test Plan

### Unit Tests
- [ ] Test `formatNumber` with various magnitudes
- [ ] Test `formatDuration` edge cases
- [ ] Test `calculateChange` with zero, positive, negative

### Visual Tests
- [ ] Responsive layout at all breakpoints
- [ ] Loading state skeleton
- [ ] Trend colors correct

---

## Accessibility

- Info button for screen readers
- Tabular number formatting for alignment
- Sufficient color contrast for trend indicators
- ARIA labels for trend direction
