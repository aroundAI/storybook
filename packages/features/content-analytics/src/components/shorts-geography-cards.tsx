'use client';

import { Film, Globe, MapPin, Video } from 'lucide-react';

import type { LanguageDimension } from '@kit/clickhouse';
import { Skeleton } from '@kit/ui/skeleton';

import { formatNumber } from '../lib/format';
import {
  languageFlag,
  languageKey,
  languageName,
} from '../lib/language-labels';
import { VIEWS_NOT_MEASURED, formatViews } from '../lib/views';
import type {
  GeographyByLanguage,
  ShortsSourcePerformance,
} from '../server/language-analytics';
import { LanguageDimensionLabel } from './language-dimension-label';
import { AnalyticsCard } from './overview/analytics-card';
import type { CardClaim } from './overview/card-claim';
import { RateDenominator } from './rate-denominator';

// =============================================================================
// Top Shorts Card (Phase 3)
// =============================================================================

interface TopShortsCardProps {
  data: ShortsSourcePerformance[];
  /** Which language each short is labelled with; named on the card. */
  dimension?: LanguageDimension;
  isLoading?: boolean;
}

/** The leading short's views, and which short it is. */
export function topShortsClaim(
  data: readonly ShortsSourcePerformance[],
): CardClaim {
  const top = data[0];

  if (!top) {
    return {
      figure: null,
      noFigure: 'No shorts yet.',
      sentence: 'Publish shorts to see which clips have the most views.',
    };
  }

  // Not measured sorts last, so a top short without views means none has
  // them (KB-153): no figure, never a 0.
  if (top.views === null) {
    return {
      figure: null,
      noFigure: `Views ${VIEWS_NOT_MEASURED.toLowerCase()}`,
      sentence: 'No short here has a views figure to rank by.',
    };
  }

  const level = data.filter((short) => short.views === top.views).length;

  return level > 1
    ? {
        figure: formatNumber(top.views),
        sentence: `${level} shorts are level on views, so there is no single top short.`,
      }
    : {
        figure: formatNumber(top.views),
        sentence: `“${top.publishTitle}” has the most views of the shorts.`,
      };
}

const TOP_SHORTS_TITLE = 'Top Performing Shorts';

export function TopShortsCard({
  data,
  dimension = 'content',
  isLoading,
}: TopShortsCardProps) {
  if (isLoading) {
    return <TopShortsCardSkeleton />;
  }

  const shorts = data ?? [];

  return (
    <AnalyticsCard
      title={TOP_SHORTS_TITLE}
      icon={Video}
      metricFamily={'engagement'}
      claim={topShortsClaim(shorts)}
      data-test={'top-shorts-card'}
    >
      <div className="space-y-3">
        <LanguageDimensionLabel dimension={dimension} card="shorts" />
        {shorts.slice(0, 5).map((short, index) => (
          <div key={short.publishId} className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted font-bold text-muted-foreground">
              #{index + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {short.publishTitle}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {short.sourceEpisodeTitle && (
                  <>
                    <Film className="h-3 w-3" />
                    <span className="truncate">{short.sourceEpisodeTitle}</span>
                  </>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium tabular-nums">
                  {formatViews(short.views, formatNumber)}
                </span>
                {/* The name, not a bare flag: a short with no language
                    set has no flag, and used to show an American one. */}
                <span
                  className="text-xs text-muted-foreground"
                  data-test="top-short-language"
                >
                  {languageName(short.language, dimension)}
                </span>
              </div>
              <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                {short.engagement === null
                  ? VIEWS_NOT_MEASURED
                  : `${short.engagement.value.toFixed(1)}% eng`}
                {short.engagement && (
                  <RateDenominator
                    denominator={short.engagement.denominator}
                    figure="likes and comments per view"
                    subject={short.publishTitle}
                  />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </AnalyticsCard>
  );
}

export function TopShortsCardSkeleton() {
  return (
    <AnalyticsCard
      title={TOP_SHORTS_TITLE}
      icon={Video}
      metricFamily={'engagement'}
      claim={'loading'}
      details={null}
    >
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </AnalyticsCard>
  );
}

// =============================================================================
// Geography Card (Phase 4)
// =============================================================================

interface GeographyCardProps {
  data: GeographyByLanguage[];
  isLoading?: boolean;
}

/**
 * The largest single country share within the first language listed — a
 * share of that language's views, not of all views.
 */
export function languageGeographyClaim(
  data: readonly GeographyByLanguage[],
  dimension: LanguageDimension = 'content',
): CardClaim {
  const first = data[0];
  const top = first?.countries[0];

  if (!first || !top) {
    return {
      figure: null,
      noFigure: 'No geographic data yet.',
      sentence: 'No platform has reported where these languages are watched.',
    };
  }

  return {
    figure: `${top.percentage.toFixed(0)}%`,
    sentence: `${top.country} has the largest share of ${languageName(first.language, dimension)} views.`,
  };
}

const LANGUAGE_GEOGRAPHY_TITLE = 'Geographic Reach by Language';

export function LanguageGeographyCard({ data, isLoading }: GeographyCardProps) {
  if (isLoading) {
    return <LanguageGeographyCardSkeleton />;
  }

  const rows = data ?? [];

  return (
    <AnalyticsCard
      title={LANGUAGE_GEOGRAPHY_TITLE}
      icon={Globe}
      metricFamily={'geography'}
      claim={languageGeographyClaim(rows)}
      data-test={'language-geography-card'}
    >
      <div className="space-y-6">
        {rows.slice(0, 3).map((langData) => (
          <div key={languageKey(langData.language)} className="space-y-3">
            <div className="flex items-center gap-2 font-medium">
              {languageFlag(langData.language) ? (
                <span className="text-lg">
                  {languageFlag(langData.language)}
                </span>
              ) : null}
              <span>{languageName(langData.language)}</span>
            </div>
            <div className="space-y-2">
              {langData.countries.slice(0, 5).map((country) => (
                <div key={country.country} className="flex items-center gap-2">
                  <MapPin className="h-3 w-3 text-muted-foreground" />
                  <span className="flex-1 truncate text-sm">
                    {country.country}
                  </span>
                  <span className="text-sm font-medium tabular-nums">
                    {country.percentage.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AnalyticsCard>
  );
}

export function LanguageGeographyCardSkeleton() {
  return (
    <AnalyticsCard
      title={LANGUAGE_GEOGRAPHY_TITLE}
      icon={Globe}
      metricFamily={'geography'}
      claim={'loading'}
      details={null}
    >
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ))}
      </div>
    </AnalyticsCard>
  );
}
