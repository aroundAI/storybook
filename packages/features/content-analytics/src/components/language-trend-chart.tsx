'use client';

import { useMemo } from 'react';

import { TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { LanguageDimension } from '@kit/clickhouse';
import { Skeleton } from '@kit/ui/skeleton';

import { formatNumber } from '../lib/format';
import {
  languageColor,
  languageFromKey,
  languageName,
} from '../lib/language-labels';
import { SHOWN_ANALYTICS_PLATFORMS } from '../lib/shown-platforms';
import {
  bucketOfMark,
  isoDay,
  viewDefinitionMarks,
} from '../lib/view-definition-marks';
import type { LanguageTrendEntry } from '../server/language-analytics';
import { LanguageDimensionLabel } from './language-dimension-label';
import { AnalyticsCard } from './overview/analytics-card';
import type { CardClaim } from './overview/card-claim';

interface LanguageTrendChartProps {
  data: LanguageTrendEntry[];
  /** Which language the series are grouped by; named on the card. */
  dimension?: LanguageDimension;
  isLoading?: boolean;
}

const TITLE = 'Language Performance Trend';

function dayInWords(date: string): string {
  return new Date(`${isoDay(date)}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The views the chart stacks, over the days it draws. */
export function languageTrendClaim(
  data: readonly LanguageTrendEntry[],
): CardClaim {
  const first = data[0];
  const last = data.at(-1);

  if (!first || !last) {
    return {
      figure: null,
      noFigure: 'No trend data yet.',
      sentence:
        'Daily views by language appear once published content has views.',
    };
  }

  const total = data.reduce(
    (sum, entry) =>
      sum +
      Object.values(entry.viewsByLanguage).reduce((a, views) => a + views, 0),
    0,
  );

  return {
    figure: formatNumber(total),
    sentence: `Views per day by language, ${dayInWords(first.date)} to ${dayInWords(last.date)}.`,
  };
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

  const languages = useMemo(() => {
    const langSet = new Set<string>();
    for (const entry of data) {
      for (const lang of Object.keys(entry.viewsByLanguage)) {
        langSet.add(lang);
      }
    }
    return Array.from(langSet);
  }, [data]);

  const chartData = useMemo(
    () =>
      data.map((entry) => ({
        date: entry.date,
        ...entry.viewsByLanguage,
      })),
    [data],
  );

  // The trend pools every platform's daily views, so a change in what any
  // of them counts as a view is marked where it falls (FILM-1722).
  const marks = useMemo(() => {
    const dates = data.map((entry) => isoDay(entry.date)).sort();

    return viewDefinitionMarks(
      SHOWN_ANALYTICS_PLATFORMS,
      dates[0],
      dates.at(-1),
    );
  }, [data]);

  if (isLoading) {
    return <LanguageTrendChartSkeleton />;
  }

  const hasSeries = data.length > 0 && languages.length > 0;
  const dates = data.map((entry) => entry.date);

  return (
    <AnalyticsCard
      title={TITLE}
      icon={TrendingUp}
      metricFamily={'engagement'}
      claim={languageTrendClaim(hasSeries ? data : [])}
      marks={hasSeries ? marks : []}
      data-test={'language-trend-chart'}
    >
      <div className="space-y-4">
        <LanguageDimensionLabel dimension={dimension} card="trend" />
        {hasSeries && (
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
                  backgroundColor: 'var(--popover)',
                  border: '1px solid var(--border)',
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
              {/* On a category axis a line must sit on a drawn day: the
                  last one on or before the change. */}
              {marks.map((mark) => {
                const x = dates.find(
                  (date) => isoDay(date) === bucketOfMark(dates, mark),
                );

                return x ? (
                  <ReferenceLine
                    key={`${mark.platform}:${mark.date}`}
                    x={x}
                    stroke="currentColor"
                    strokeDasharray="4 4"
                    className="text-muted-foreground"
                  />
                ) : null;
              })}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </AnalyticsCard>
  );
}

export function LanguageTrendChartSkeleton() {
  return (
    <AnalyticsCard
      title={TITLE}
      icon={TrendingUp}
      metricFamily={'engagement'}
      claim={'loading'}
      details={null}
    >
      <Skeleton className="h-[300px] w-full" />
    </AnalyticsCard>
  );
}
