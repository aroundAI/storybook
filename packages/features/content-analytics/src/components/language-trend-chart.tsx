'use client';

import { useMemo } from 'react';

import { TrendingUp } from 'lucide-react';
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

import type { LanguageDimension } from '@kit/clickhouse';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';

import {
  languageColor,
  languageFromKey,
  languageName,
} from '../lib/language-labels';
import type { LanguageTrendEntry } from '../server/language-analytics';
import { LanguageDimensionLabel } from './language-dimension-label';

interface LanguageTrendChartProps {
  data: LanguageTrendEntry[];
  /** Which language the series are grouped by; named on the card. */
  dimension?: LanguageDimension;
  isLoading?: boolean;
}

export function LanguageTrendChart({
  data,
  dimension = 'content',
  isLoading,
}: LanguageTrendChartProps) {
  // Series are keyed by `languageKey`, so the unlabelled one arrives as a
  // sentinel string. Named through here, or the legend prints the sentinel.
  const seriesName = (key: string) =>
    languageName(languageFromKey(key), dimension);

  // Get unique languages from data
  const languages = useMemo(() => {
    const langSet = new Set<string>();
    for (const entry of data) {
      for (const lang of Object.keys(entry.viewsByLanguage)) {
        langSet.add(lang);
      }
    }
    return Array.from(langSet);
  }, [data]);

  // Transform data for Recharts
  const chartData = useMemo(() => {
    return data.map((entry) => ({
      date: entry.date,
      ...entry.viewsByLanguage,
    }));
  }, [data]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" />
            Language Performance Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0 || languages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" />
            Language Performance Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No trend data available. Publish content to see language trends.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-test="language-trend-chart">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4" />
          Language Performance Trend
        </CardTitle>
        <LanguageDimensionLabel dimension={dimension} card="trend" />
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => {
                const date = new Date(value);
                return date.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                });
              }}
            />
            <YAxis
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) =>
                value >= 1000
                  ? `${(value / 1000).toFixed(0)}K`
                  : value.toString()
              }
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px',
              }}
              labelFormatter={(value) => {
                const date = new Date(value);
                return date.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                });
              }}
              formatter={(value: number, name: string) => [
                value.toLocaleString(),
                seriesName(name),
              ]}
            />
            <Legend formatter={(value: string) => seriesName(value)} />
            {languages.map((lang) => (
              <Area
                key={lang}
                type="monotone"
                dataKey={lang}
                stackId="1"
                stroke={languageColor(languageFromKey(lang))}
                fill={languageColor(languageFromKey(lang))}
                fillOpacity={0.6}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function LanguageTrendChartSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-48" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[300px] w-full" />
      </CardContent>
    </Card>
  );
}
