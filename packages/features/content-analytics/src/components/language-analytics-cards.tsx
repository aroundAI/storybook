'use client';

import {
  ArrowDown,
  ArrowUp,
  Globe,
  Languages,
  Minus,
  TrendingUp,
} from 'lucide-react';

import { FORMAT_FAMILY_LABEL } from '@kit/clickhouse';
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
// Format families (FILM-1716)
// =============================================================================

interface ContentTypeCardProps {
  data: ContentTypeComparison | null;
  isLoading?: boolean;
}

const FORMAT_CARD_TITLE = 'By format family';

/**
 * A project's figures per format family, one row each.
 *
 * Deliberately no ratio between rows: a Short and a long-form video count
 * a view differently (FILM-1722) and are chosen for different reasons, so
 * "3x the views" across families compares two different measures.
 *
 * No revenue column: every pipeline writer stores a video's revenue as a
 * literal 0 (FILM-1703), so a "$0" here would be a zero nobody measured.
 */
export function ContentTypeCard({ data, isLoading }: ContentTypeCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{FORMAT_CARD_TITLE}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || (data.families.length === 0 && data.unclassified === 0)) {
    return (
      <Card data-test="format-family-card">
        <CardHeader>
          <CardTitle className="text-base">{FORMAT_CARD_TITLE}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No videos with figures in this period.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-test="format-family-card">
      <CardHeader>
        <CardTitle className="text-base">{FORMAT_CARD_TITLE}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Format</th>
                <th className="py-2 pl-3 text-right font-medium">Videos</th>
                <th className="py-2 pl-3 text-right font-medium">Views</th>
                <th className="py-2 pl-3 text-right font-medium">Engagement</th>
                <th className="py-2 pl-3 text-right font-medium">
                  Subscribers
                </th>
              </tr>
            </thead>
            <tbody>
              {data.families.map((row) => (
                <tr
                  key={row.family}
                  data-test={`format-family-row-${row.family}`}
                  className="border-b last:border-0"
                >
                  <td
                    className="py-3 font-medium"
                    data-test="format-family-name"
                  >
                    {FORMAT_FAMILY_LABEL[row.family]}
                  </td>
                  <td
                    className="py-3 pl-3 text-right tabular-nums"
                    data-test="format-family-videos"
                  >
                    {row.contentCount}
                  </td>
                  <td
                    className="py-3 pl-3 text-right tabular-nums"
                    data-test="format-family-views"
                  >
                    {formatNumber(row.views)}
                  </td>
                  <td
                    className="py-3 pl-3 text-right tabular-nums"
                    data-test="format-family-engagement"
                  >
                    {formatPercent(row.engagement)}
                  </td>
                  <td className="py-3 pl-3 text-right tabular-nums">
                    {formatNumber(row.subscribersGained)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 space-y-1 text-xs text-muted-foreground">
          {data.durationUnknown > 0 && (
            <p data-test="format-family-duration-unknown">
              {data.durationUnknown} placed by their declared type: the platform
              has not reported how long they are.
            </p>
          )}
          {data.unclassified > 0 && (
            <p data-test="format-family-unclassified">
              {data.unclassified} not shown: their type is not one any format
              family covers.
            </p>
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
