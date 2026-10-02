'use client';

import { useCallback, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DollarSign,
  FileText,
  Minus,
  PieChart,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { unwrap } from '@kit/next/action-result';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';

import { localToday } from '../lib/local-date';
import { formatLocalDate } from '../lib/manual-revenue';
import { currencyLabel, formatCurrencyAmount } from '../lib/money';
import { isUnavailable } from '../lib/query-state';
import {
  dashboardCurrencies,
  zeroRevenueProjection,
  zeroRevenueSummary,
} from '../lib/revenue-by-currency';
import type { RevenueProjection, RevenueSummary } from '../lib/types/revenue';
import {
  getRevenueProjectionAction,
  getRevenueSummaryAction,
  getRevenueTimeSeriesAction,
  getTopContentByRevenueAction,
} from '../server/revenue-actions';
import { DateRangePicker, type DateRangeValue } from './date-range-picker';
import { ManualRevenueForm } from './manual-revenue-form';
import { RateDenominator } from './rate-denominator';
import { RevenueChart } from './revenue-chart';
import { RevenueMixCard } from './revenue-mix-card';
import { RevenuePlatformBreakdown } from './revenue-platform-breakdown';
import { RevenueTopContent } from './revenue-top-content';

type DashboardTab = 'overview' | 'platforms' | 'content' | 'manual';

interface RevenueDashboardProps {
  accountId: string;
  initialTab?: DashboardTab;
  onTabChange?: (tab: DashboardTab) => void;
}

export function RevenueDashboard({
  accountId,
  initialTab = 'overview',
  onTabChange,
}: RevenueDashboardProps) {
  const queryClient = useQueryClient();

  // Date range state (default to last 30 days)
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return { from: start, to: end };
  });

  // Tab state
  const [activeTab, setActiveTabState] = useState<DashboardTab>(initialTab);

  const setActiveTab = useCallback(
    (newTab: string) => {
      const tab = newTab as DashboardTab;
      setActiveTabState(tab);
      onTabChange?.(tab);
    },
    [onTabChange],
  );

  // Format dates for API calls
  const startDate = formatLocalDate(dateRange.from);
  const endDate = formatLocalDate(dateRange.to);

  // Fetch revenue summary — one per currency (KB-12)
  const {
    data: summaries,
    isLoading: summaryLoading,
    isError: summaryIsError,
  } = useQuery({
    queryKey: ['revenue-summary', accountId, startDate, endDate] as const,
    queryFn: () =>
      getRevenueSummaryAction({
        accountId,
        startDate: startDate!,
        endDate: endDate!,
      }),
    enabled: !!startDate && !!endDate,
  });

  // Fetch projection — one per currency. Its window ends on this browser's
  // date (KB-24), the calendar a manual entry is dated in; in the key so the
  // window moves at local midnight rather than at UTC's.
  const asOf = localToday();
  const {
    data: projections,
    isLoading: projectionLoading,
    isError: projectionIsError,
  } = useQuery({
    queryKey: ['revenue-projection', accountId, asOf] as const,
    queryFn: () => unwrap(getRevenueProjectionAction({ accountId, asOf })),
  });

  // Fetch time series data
  const {
    data: timeSeries,
    isLoading: timeSeriesLoading,
    isError: timeSeriesIsError,
  } = useQuery({
    queryKey: ['revenue-timeseries', accountId, startDate, endDate] as const,
    queryFn: () =>
      getRevenueTimeSeriesAction({
        accountId,
        startDate: startDate!,
        endDate: endDate!,
      }),
    enabled: activeTab === 'overview' && !!startDate && !!endDate,
  });

  // Fetch top content
  const {
    data: topContent,
    isLoading: topContentLoading,
    isError: topContentIsError,
  } = useQuery({
    queryKey: ['revenue-top-content', accountId, startDate, endDate] as const,
    queryFn: () =>
      getTopContentByRevenueAction({
        accountId,
        startDate: startDate!,
        endDate: endDate!,
        limit: 10,
      }),
    enabled: activeTab === 'content' && !!startDate && !!endDate,
  });

  // A failed *refetch* keeps the last good answer, so "unavailable" is
  // errored *and* empty — otherwise a transient failure blanks a dashboard
  // that still has figures to show.
  const summaryUnavailable = isUnavailable({
    isError: summaryIsError,
    data: summaries,
  });
  const projectionUnavailable = isUnavailable({
    isError: projectionIsError,
    data: projections,
  });
  const topContentUnavailable = isUnavailable({
    isError: topContentIsError,
    data: topContent,
  });
  const timeSeriesUnavailable = isUnavailable({
    isError: timeSeriesIsError,
    data: timeSeries,
  });

  const handleManualRevenueSuccess = () => {
    // Invalidate queries to refresh data
    queryClient.invalidateQueries({ queryKey: ['revenue-summary', accountId] });
    queryClient.invalidateQueries({
      queryKey: ['revenue-timeseries', accountId],
    });
    queryClient.invalidateQueries({
      queryKey: ['revenue-top-content', accountId],
    });
    // The projection reads the last 30 days, which a saved entry is in.
    // Left stale, a first euro entry showed "€50" beside a "€0" projection.
    queryClient.invalidateQueries({
      queryKey: ['revenue-projection', accountId],
    });
  };

  // One card per currency (KB-12, decided by the product owner): there are
  // no exchange rates here, so an account paid in dollars and euros gets a
  // row of tiles, a chart, a mix and a ranking for each, and never a figure
  // that adds the two. With one currency — every account until someone
  // types a second — nothing is repeated and nothing names the currency,
  // which is the dashboard as it always was.
  const period = { start: startDate ?? '', end: endDate ?? '' };
  const currencies = dashboardCurrencies(summaries ?? [], projections ?? []);

  const byCurrency = currencies.map((currency) => ({
    currency,
    // Beside a title only when there is more than one to tell apart.
    suffix: currencies.length > 1 ? ` · ${currencyLabel(currency)}` : '',
    summary:
      summaries?.find((summary) => summary.currency === currency) ??
      zeroRevenueSummary(currency, period),
    projection:
      projections?.find((projection) => projection.currency === currency) ??
      zeroRevenueProjection(currency),
    // The series action always returns at least one zero-filled series, so
    // a currency with no rows in the range still gets its flat line.
    points:
      timeSeries?.find((series) => series.currency === currency)?.points ??
      (timeSeries?.[0]?.points ?? []).map((point) => ({
        ...point,
        revenueCents: 0,
      })),
    topContent:
      topContent?.find((ranking) => ranking.currency === currency)?.items ?? [],
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Revenue</h2>
          <p className="text-muted-foreground">
            Track your earnings across all platforms
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <Button variant="outline">
            <FileText className="mr-2 h-4 w-4" />
            Generate Report
          </Button>
        </div>
      </div>

      {/* Summary Cards — one row per currency */}
      {byCurrency.map(({ currency, suffix, summary, projection }) => (
        <RevenueSummaryTiles
          key={currency ?? 'unrecorded'}
          currency={currency}
          titleSuffix={suffix}
          summary={summary}
          projection={projection}
          summaryLoading={summaryLoading}
          summaryUnavailable={summaryUnavailable}
          projectionLoading={projectionLoading}
          projectionUnavailable={projectionUnavailable}
        />
      ))}

      {/* Main Content Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="overview" data-test="revenue-tab-overview">
            Overview
          </TabsTrigger>
          <TabsTrigger value="platforms" data-test="revenue-tab-platforms">
            By Platform
          </TabsTrigger>
          <TabsTrigger value="content" data-test="revenue-tab-content">
            By Content
          </TabsTrigger>
          <TabsTrigger value="manual" data-test="revenue-tab-manual">
            Manual Entry
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {byCurrency.map(({ currency, suffix, points }) => (
            <Card
              key={currency ?? 'unrecorded'}
              data-test="revenue-chart-card"
              data-currency={currency ?? ''}
            >
              <CardHeader>
                <CardTitle>Revenue Over Time{suffix}</CardTitle>
              </CardHeader>
              <CardContent>
                {timeSeriesUnavailable ? (
                  <SummaryUnavailable tile="time-series" />
                ) : (
                  <RevenueChart
                    data={points}
                    currency={currency}
                    isLoading={timeSeriesLoading}
                  />
                )}
              </CardContent>
            </Card>
          ))}

          {/*
            The only display path revenue categories have: without it, a new
            category (FILM-1609 licensing) could be recorded and shown to
            nobody. One per currency: a mix is shares, and a share across
            two currencies needs a rate nobody has.
          */}
          {byCurrency.map(({ currency, suffix, summary }) => (
            <Card
              key={currency ?? 'unrecorded'}
              data-test="revenue-mix-card"
              data-currency={currency ?? ''}
            >
              <CardHeader>
                <CardTitle>Revenue Mix{suffix}</CardTitle>
              </CardHeader>
              <CardContent>
                {/*
                  A failed summary leaves `byType` empty, and the card reads
                  an empty mix as "no revenue recorded" — a measured claim
                  off a read that never landed.
                */}
                {summaryUnavailable ? (
                  <p
                    className="text-sm text-destructive"
                    data-test="revenue-mix-error"
                  >
                    Revenue could not be loaded.
                  </p>
                ) : (
                  <RevenueMixCard
                    byType={summary.byType}
                    currency={currency}
                    isLoading={summaryLoading}
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="platforms" className="space-y-4">
          {/*
            Same failed summary as the tiles and the mix: without this the tab
            prints "No revenue data by platform", which is a measurement.
          */}
          {summaryUnavailable ? (
            <SummaryUnavailable tile="platforms" />
          ) : (
            byCurrency.map(({ currency, suffix, summary }) => (
              <div
                key={currency ?? 'unrecorded'}
                className="space-y-2"
                data-test="revenue-platforms"
                data-currency={currency ?? ''}
              >
                {suffix ? (
                  <h3 className="text-sm font-medium text-muted-foreground">
                    {currencyLabel(currency)}
                  </h3>
                ) : null}
                <RevenuePlatformBreakdown
                  breakdown={summary.byPlatform}
                  total={summary.totalRevenueCents}
                  currency={currency}
                  isLoading={summaryLoading}
                />
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="content" className="space-y-4">
          {topContentUnavailable ? (
            <SummaryUnavailable tile="content" />
          ) : (
            byCurrency.map(({ currency, suffix, topContent: items }) => (
              <RevenueTopContent
                key={currency ?? 'unrecorded'}
                data={items}
                currency={currency}
                titleSuffix={suffix}
                isLoading={topContentLoading}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="manual">
          <ManualRevenueForm
            accountId={accountId}
            onSuccess={handleManualRevenueSuccess}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function RevenueDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="mt-2 h-4 w-48" />
        </div>
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-[280px]" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-8 w-32" />
              <Skeleton className="mt-1 h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Skeleton className="h-[400px] w-full" />
    </div>
  );
}

const WHOLE_UNITS = { minimumFractionDigits: 0, maximumFractionDigits: 0 };

/**
 * The four summary tiles, for one currency.
 *
 * Every figure here is an amount of `currency`: the trend is against the
 * same currency a period earlier, and the RPM is this currency's cents per
 * thousand views. The tiles have always shown whole units, so they still do.
 */
function RevenueSummaryTiles({
  currency,
  titleSuffix,
  summary,
  projection,
  summaryLoading,
  summaryUnavailable,
  projectionLoading,
  projectionUnavailable,
}: {
  currency: string | null;
  titleSuffix: string;
  summary: RevenueSummary;
  projection: RevenueProjection;
  summaryLoading: boolean;
  summaryUnavailable: boolean;
  projectionLoading: boolean;
  projectionUnavailable: boolean;
}) {
  const formatCents = (cents: number) =>
    formatCurrencyAmount({ currency, cents }, WHOLE_UNITS);

  const TrendIcon =
    summary.trend === 'up'
      ? TrendingUp
      : summary.trend === 'down'
        ? TrendingDown
        : Minus;

  const trendColor =
    summary.trend === 'up'
      ? 'text-green-600'
      : summary.trend === 'down'
        ? 'text-red-600'
        : 'text-muted-foreground';

  return (
    <div
      className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
      data-test="revenue-tiles"
      data-currency={currency ?? ''}
    >
      <Card data-test="revenue-tile-total">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Total Revenue{titleSuffix}
          </CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : summaryUnavailable ? (
            <SummaryUnavailable tile="total" />
          ) : (
            <>
              <div
                className="text-2xl font-bold"
                data-test="revenue-tile-value"
              >
                {formatCents(summary.totalRevenueCents)}
              </div>
              <div
                className={`flex items-center text-xs ${trendColor}`}
                data-test="revenue-tile-trend"
              >
                <TrendIcon className="mr-1 h-3 w-3" />
                {summary.trendPercent > 0 ? '+' : ''}
                {summary.trendPercent.toFixed(1)}% from previous period
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card data-test="revenue-tile-daily">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Daily Average{titleSuffix}
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : summaryUnavailable ? (
            <SummaryUnavailable tile="daily" />
          ) : (
            <>
              <div
                className="text-2xl font-bold"
                data-test="revenue-tile-value"
              >
                {formatCents(summary.averageDailyRevenueCents)}
              </div>
              <p className="text-xs text-muted-foreground">per day</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card data-test="revenue-tile-rpm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            RPM{titleSuffix}
          </CardTitle>
          <PieChart className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : summaryUnavailable ? (
            <SummaryUnavailable tile="rpm" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <div
                  className="text-2xl font-bold"
                  data-test="revenue-tile-value"
                >
                  {formatCents(summary.rpm)}
                </div>
                <RateDenominator
                  denominator={summary.rpmDenominator}
                  figure="RPM"
                />
              </div>
              <p className="text-xs text-muted-foreground">per 1,000 views</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card data-test="revenue-tile-projection">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Monthly Projection{titleSuffix}
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {projectionLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : projectionUnavailable ? (
            <SummaryUnavailable tile="projection" />
          ) : (
            <>
              <div
                className="text-2xl font-bold"
                data-test="revenue-tile-value"
              >
                {formatCents(projection.estimatedMonthlyRevenueCents)}
              </div>
              <p className="text-xs text-muted-foreground">
                {projection.confidenceLevel} confidence
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * What a tile shows when its read failed.
 *
 * `?? 0` renders a failed read as a measured zero — and these tiles sat
 * directly above the revenue mix's own "could not be loaded", so the same
 * screen both admitted the failure and reported $0.00 from it.
 */
function SummaryUnavailable({ tile }: { tile: string }) {
  return (
    <p
      className="text-sm text-destructive"
      data-test={`revenue-summary-error-${tile}`}
    >
      Revenue could not be loaded.
    </p>
  );
}
