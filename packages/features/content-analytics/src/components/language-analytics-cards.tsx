'use client';

import {
  ArrowDown,
  ArrowUp,
  Globe,
  Languages,
  Minus,
  TrendingUp,
} from 'lucide-react';

import type { LanguageDimension } from '@kit/clickhouse';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Progress } from '@kit/ui/progress';
import { Skeleton } from '@kit/ui/skeleton';
import { cn } from '@kit/ui/utils';

import { formatNumber, formatPercent } from '../lib/format';
import {
  LANGUAGE_CHECKPOINT_DAYS,
  languageFlag,
  languageKey,
  languageName,
} from '../lib/language-labels';
import type {
  ContentTypeComparison,
  LanguagePerformance,
  PlatformLanguageEntry,
} from '../server/language-analytics';
import { LanguageDimensionLabel } from './language-dimension-label';

// =============================================================================
// Language Performance Card
// =============================================================================

interface LanguagePerformanceCardProps {
  data: LanguagePerformance[];
  /** Which language the rows are grouped by; named on the card. */
  dimension?: LanguageDimension;
  isLoading?: boolean;
}

/**
 * What a language's checkpoint says about how far to trust its row.
 *
 * FILM-1606's convention: a thin sample is dimmed and carries its n, never
 * hidden — a hard gate would remove the only figure a new channel has.
 */
function checkpointNote(lang: LanguagePerformance): string {
  if (!lang.checkpoint) {
    return `${lang.videoCount} ${lang.videoCount === 1 ? 'video' : 'videos'}, none ${LANGUAGE_CHECKPOINT_DAYS} days old yet`;
  }

  const { medianViews, matureVideoCount, days, confidence } = lang.checkpoint;
  const figures = `${formatNumber(medianViews)} median at ${days} days · ${matureVideoCount} of ${lang.videoCount} videos`;

  if (confidence === 'insufficient') {
    return `${figures} · too few to report`;
  }

  return confidence === 'directional'
    ? `${figures} · directional only`
    : figures;
}

function isReportable(lang: LanguagePerformance): boolean {
  return lang.checkpoint?.confidence === 'reportable';
}

export function LanguagePerformanceCard({
  data,
  dimension = 'content',
  isLoading,
}: LanguagePerformanceCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Languages className="h-4 w-4" />
            Language Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-2 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Languages className="h-4 w-4" />
            Language Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No language data available yet. Publish content in different
            languages to see performance breakdown.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalViews = data.reduce((sum, l) => sum + l.views, 0);
  // Never the unlabelled bucket, and never a sample too thin to report: on
  // most projects "not set" has the most views, and crowning it would
  // repeat the old defect under a new name.
  const topPerformer = data.find(
    (lang) => lang.language !== null && isReportable(lang),
  );

  return (
    <Card data-test="language-performance-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Languages className="h-4 w-4" />
          Language Performance
        </CardTitle>
        <LanguageDimensionLabel dimension={dimension} card="performance" />
      </CardHeader>
      <CardContent className="space-y-4">
        {data.slice(0, 6).map((lang) => {
          const percentage =
            totalViews > 0 ? (lang.views / totalViews) * 100 : 0;
          const TrendIcon =
            lang.viewsChange > 0
              ? ArrowUp
              : lang.viewsChange < 0
                ? ArrowDown
                : Minus;
          const trendColor =
            lang.viewsChange > 0
              ? 'text-green-600'
              : lang.viewsChange < 0
                ? 'text-red-600'
                : 'text-muted-foreground';

          return (
            <div
              key={languageKey(lang.language)}
              className={cn('space-y-2', !isReportable(lang) && 'opacity-60')}
              data-test={`language-row-${languageKey(lang.language)}`}
              data-confidence={lang.checkpoint?.confidence ?? 'none'}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {languageFlag(lang.language) ? (
                    <span className="text-lg">
                      {languageFlag(lang.language)}
                    </span>
                  ) : null}
                  <span className="font-medium" data-test="language-row-name">
                    {languageName(lang.language, dimension)}
                  </span>
                  {lang === topPerformer && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      ⭐ Top
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-sm font-medium tabular-nums"
                    data-test="language-row-views"
                  >
                    {formatNumber(lang.views)}
                  </span>
                  <div
                    className={`flex items-center gap-0.5 text-xs ${trendColor}`}
                  >
                    <TrendIcon className="h-3 w-3" />
                    <span>{formatPercent(Math.abs(lang.viewsChange))}</span>
                  </div>
                </div>
              </div>
              <Progress value={percentage} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span data-test="language-row-share">
                  {formatPercent(percentage)} of total
                </span>
                <span>{formatPercent(lang.engagement)} engagement</span>
              </div>
              <p
                className="text-xs text-muted-foreground"
                data-test="language-row-checkpoint"
              >
                {checkpointNote(lang)}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Platform × Language Matrix
// =============================================================================

interface PlatformLanguageMatrixProps {
  data: PlatformLanguageEntry[];
  /** Which language the columns are grouped by; named on the card. */
  dimension?: LanguageDimension;
  isLoading?: boolean;
}

const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'X (Twitter)',
  linkedin: 'LinkedIn',
};

export function PlatformLanguageMatrix({
  data,
  dimension = 'content',
  isLoading,
}: PlatformLanguageMatrixProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" />
            Platform × Language
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" />
            Platform × Language
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No cross-platform data available yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Group by platform
  const platforms = [...new Set(data.map((d) => d.platform))];
  const languages = [...new Set(data.map((d) => d.language))];

  // Create matrix
  const matrix = new Map<string, Map<string | null, PlatformLanguageEntry>>();
  for (const entry of data) {
    if (!matrix.has(entry.platform)) {
      matrix.set(entry.platform, new Map());
    }
    matrix.get(entry.platform)!.set(entry.language, entry);
  }

  // Find best combo — among labelled languages only. "Best: not set" names
  // nothing anyone could act on.
  const bestEntry = data
    .filter((entry) => entry.language !== null)
    .reduce<
      PlatformLanguageEntry | undefined
    >((best, entry) => (!best || entry.engagementRate > best.engagementRate ? entry : best), undefined);

  return (
    <Card data-test="platform-language-matrix">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-4 w-4" />
          Platform × Language Performance
        </CardTitle>
        <LanguageDimensionLabel dimension={dimension} card="matrix" />
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Platform</th>
                {languages.map((lang) => (
                  <th
                    key={languageKey(lang)}
                    className="px-2 py-2 text-center font-medium"
                    data-test={`matrix-language-${languageKey(lang)}`}
                  >
                    {/* The name, not only the flag: a flag is a country,
                        and "not set" has neither. */}
                    {languageFlag(lang) ? `${languageFlag(lang)} ` : ''}
                    {languageName(lang, dimension)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {platforms.map((platform) => (
                <tr key={platform} className="border-b last:border-0">
                  <td className="py-3 font-medium">
                    {PLATFORM_LABELS[platform] || platform}
                  </td>
                  {languages.map((lang) => {
                    const entry = matrix.get(platform)?.get(lang);
                    const isBest = !!entry && entry === bestEntry;

                    return (
                      <td
                        key={languageKey(lang)}
                        className={`px-2 py-3 text-center ${isBest ? 'bg-green-50 dark:bg-green-900/20' : ''}`}
                        data-test={`matrix-cell-${platform}-${languageKey(lang)}`}
                      >
                        {entry ? (
                          <div>
                            <div className="font-medium tabular-nums">
                              {formatNumber(entry.views)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatPercent(entry.engagementRate)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {bestEntry && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
            <TrendingUp className="h-4 w-4" />
            Best: {languageName(bestEntry.language, dimension)} on{' '}
            {PLATFORM_LABELS[bestEntry.platform] || bestEntry.platform} (
            {formatPercent(bestEntry.engagementRate)} engagement)
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Content Type Comparison (Shorts vs Long-form)
// =============================================================================

interface ContentTypeCardProps {
  data: ContentTypeComparison | null;
  isLoading?: boolean;
}

export function ContentTypeCard({ data, isLoading }: ContentTypeCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shorts vs Long-form</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shorts vs Long-form</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No content type data available.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { longForm, shorts } = data;

  const metrics = [
    {
      label: 'Views',
      longForm: longForm.views,
      shorts: shorts.views,
      format: formatNumber,
    },
    {
      label: 'Engagement',
      longForm: longForm.engagement,
      shorts: shorts.engagement,
      format: (v: number) => formatPercent(v),
    },
    {
      label: 'Subscribers',
      longForm: longForm.subscribersGained,
      shorts: shorts.subscribersGained,
      format: formatNumber,
    },
    {
      label: 'Revenue',
      longForm: longForm.revenueCents / 100,
      shorts: shorts.revenueCents / 100,
      format: (v: number) => `$${v.toFixed(0)}`,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Shorts vs Long-form</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Metric</th>
                <th className="py-2 text-center font-medium">
                  📺 Long-form
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({longForm.contentCount})
                  </span>
                </th>
                <th className="py-2 text-center font-medium">
                  🎬 Shorts
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({shorts.contentCount})
                  </span>
                </th>
                <th className="py-2 text-center font-medium">Ratio</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => {
                const ratio =
                  metric.longForm > 0
                    ? metric.shorts / metric.longForm
                    : metric.shorts > 0
                      ? Infinity
                      : 1;
                const ratioText =
                  ratio === Infinity
                    ? '∞'
                    : ratio >= 1
                      ? `${ratio.toFixed(1)}×`
                      : `1:${(1 / ratio).toFixed(1)}`;

                return (
                  <tr key={metric.label} className="border-b last:border-0">
                    <td className="py-3 font-medium">{metric.label}</td>
                    <td className="py-3 text-center tabular-nums">
                      {metric.format(metric.longForm)}
                    </td>
                    <td className="py-3 text-center tabular-nums">
                      {metric.format(metric.shorts)}
                    </td>
                    <td
                      className={`py-3 text-center font-medium ${ratio > 1 ? 'text-green-600' : ratio < 1 ? 'text-amber-600' : ''}`}
                    >
                      {ratioText}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Insight */}
        <div className="mt-4 space-y-2 text-sm">
          {shorts.views > longForm.views && (
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 p-2 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
              🎬 Shorts drive {formatNumber(shorts.views - longForm.views)} more
              views
            </div>
          )}
          {shorts.subscribersGained > longForm.subscribersGained && (
            <div className="flex items-center gap-2 rounded-lg bg-purple-50 p-2 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400">
              👥 Shorts gain more subscribers (+
              {formatNumber(
                shorts.subscribersGained - longForm.subscribersGained,
              )}
              )
            </div>
          )}
          {longForm.revenueCents > shorts.revenueCents && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 p-2 text-green-700 dark:bg-green-900/20 dark:text-green-400">
              💰 Long-form generates more revenue
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Skeletons
// =============================================================================

export function LanguagePerformanceCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-2 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function PlatformLanguageMatrixSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-48" />
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ContentTypeCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-36" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  );
}
