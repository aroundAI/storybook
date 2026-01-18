'use client';

import {
  ArrowDown,
  ArrowUp,
  Globe,
  Languages,
  Minus,
  TrendingUp,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Progress } from '@kit/ui/progress';
import { Skeleton } from '@kit/ui/skeleton';

import { formatNumber, formatPercent } from '../lib/format';
import type {
  ContentTypeComparison,
  LanguagePerformance,
  PlatformLanguageEntry,
} from '../server/language-analytics';

// Language code to name mapping
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  es: 'Spanish',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  ru: 'Russian',
  it: 'Italian',
};

// Language code to flag emoji
const LANGUAGE_FLAGS: Record<string, string> = {
  en: '🇺🇸',
  hi: '🇮🇳',
  es: '🇪🇸',
  pt: '🇧🇷',
  fr: '🇫🇷',
  de: '🇩🇪',
  ja: '🇯🇵',
  ko: '🇰🇷',
  zh: '🇨🇳',
  ar: '🇸🇦',
  ru: '🇷🇺',
  it: '🇮🇹',
};

function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code] || code.toUpperCase();
}

function getLanguageFlag(code: string): string {
  return LANGUAGE_FLAGS[code] || '🌐';
}

// =============================================================================
// Language Performance Card
// =============================================================================

interface LanguagePerformanceCardProps {
  data: LanguagePerformance[];
  isLoading?: boolean;
}

export function LanguagePerformanceCard({
  data,
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
          <p className="text-muted-foreground text-sm">
            No language data available yet. Publish content in different
            languages to see performance breakdown.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalViews = data.reduce((sum, l) => sum + l.views, 0);
  const topPerformer = data[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Languages className="h-4 w-4" />
          Language Performance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.slice(0, 5).map((lang) => {
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
            <div key={lang.language} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">
                    {getLanguageFlag(lang.language)}
                  </span>
                  <span className="font-medium">
                    {getLanguageName(lang.language)}
                  </span>
                  {lang === topPerformer && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      ⭐ Top
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium tabular-nums">
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
              <div className="text-muted-foreground flex justify-between text-xs">
                <span>{formatPercent(percentage)} of total</span>
                <span>{formatPercent(lang.engagement)} engagement</span>
              </div>
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
          <p className="text-muted-foreground text-sm">
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
  const matrix = new Map<string, Map<string, PlatformLanguageEntry>>();
  for (const entry of data) {
    if (!matrix.has(entry.platform)) {
      matrix.set(entry.platform, new Map());
    }
    matrix.get(entry.platform)!.set(entry.language, entry);
  }

  // Find best combo
  const bestEntry = data.reduce(
    (best, entry) =>
      entry.engagementRate > best.engagementRate ? entry : best,
    data[0]!,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-4 w-4" />
          Platform × Language Performance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Platform</th>
                {languages.map((lang) => (
                  <th key={lang} className="px-2 py-2 text-center font-medium">
                    {getLanguageFlag(lang)}
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
                    const isBest =
                      entry?.platform === bestEntry?.platform &&
                      entry?.language === bestEntry?.language;

                    return (
                      <td
                        key={lang}
                        className={`px-2 py-3 text-center ${isBest ? 'bg-green-50 dark:bg-green-900/20' : ''}`}
                      >
                        {entry ? (
                          <div>
                            <div className="font-medium tabular-nums">
                              {formatNumber(entry.views)}
                            </div>
                            <div className="text-muted-foreground text-xs">
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
            Best: {getLanguageName(bestEntry.language)} on{' '}
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
          <p className="text-muted-foreground text-sm">
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
                  <span className="text-muted-foreground ml-1 text-xs">
                    ({longForm.contentCount})
                  </span>
                </th>
                <th className="py-2 text-center font-medium">
                  🎬 Shorts
                  <span className="text-muted-foreground ml-1 text-xs">
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
