'use client';

import { Film, Globe, MapPin, Video } from 'lucide-react';

import type { LanguageDimension } from '@kit/clickhouse';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
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

// =============================================================================
// Top Shorts Card (Phase 3)
// =============================================================================

interface TopShortsCardProps {
  data: ShortsSourcePerformance[];
  /** Which language each short is labelled with; named on the card. */
  dimension?: LanguageDimension;
  isLoading?: boolean;
}

export function TopShortsCard({
  data,
  dimension = 'content',
  isLoading,
}: TopShortsCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Video className="h-4 w-4" />
            Top Performing Shorts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-10 w-16 rounded" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
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
            <Video className="h-4 w-4" />
            Top Performing Shorts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No shorts data available. Publish shorts to see which clips perform
            best.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Video className="h-4 w-4" />
          Top Performing Shorts
        </CardTitle>
        <LanguageDimensionLabel dimension={dimension} card="shorts" />
      </CardHeader>
      <CardContent className="space-y-3">
        {data.slice(0, 5).map((short, index) => (
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
              <div className="text-xs text-muted-foreground">
                {short.engagement === null
                  ? VIEWS_NOT_MEASURED
                  : `${short.engagement.toFixed(1)}% eng`}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function TopShortsCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Geography Card (Phase 4)
// =============================================================================

interface GeographyCardProps {
  data: GeographyByLanguage[];
  isLoading?: boolean;
}

export function LanguageGeographyCard({ data, isLoading }: GeographyCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" />
            Geographic Reach by Language
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
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
            <Globe className="h-4 w-4" />
            Geographic Reach by Language
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No geographic data available yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-4 w-4" />
          Geographic Reach by Language
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {data.slice(0, 3).map((langData) => (
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
      </CardContent>
    </Card>
  );
}

export function LanguageGeographyCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-48" />
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
