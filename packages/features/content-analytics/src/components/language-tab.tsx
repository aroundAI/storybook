'use client';

import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { LANGUAGE_DIMENSIONS } from '@kit/clickhouse';
import type { LanguageDimension } from '@kit/clickhouse';
import { ToggleGroup, ToggleGroupItem } from '@kit/ui/toggle-group';

import type { LanguageDivergence } from '../lib/language-divergence';
import {
  LANGUAGE_DIMENSION_DESCRIPTIONS,
  LANGUAGE_DIMENSION_LABELS,
  languageName,
  resolveLanguageDimension,
} from '../lib/language-labels';
import {
  getContentTypeComparisonAction,
  getGeographyByLanguageAction,
  getLanguageDivergenceAction,
  getLanguagePerformanceAction,
  getLanguageTrendAction,
  getPlatformLanguageMatrixAction,
  getShortsSourcePerformanceAction,
} from '../server/dashboard-actions';
import type { DateRangeValue } from './date-range-picker';
import {
  LanguageAnalyticsDashboard,
  LanguageAnalyticsDashboardSkeleton,
} from './language-analytics-dashboard';

interface LanguageTabProps {
  projectId: string;
  dateRange: DateRangeValue;
}

/**
 * The Language tab: which language the figures are grouped by, and the
 * figures.
 *
 * There are two languages to group by and they answer different questions
 * (FILM-1702). The tab was built on the channel's target while everything
 * else filtered on the publish's own, and nothing on screen said which — so
 * the choice is a visible control here, named again on every card below it.
 *
 * The toggle sits outside the loading state on purpose. Switching it
 * refetches every card, and a control that disappears while its own effect
 * loads cannot be seen to have changed.
 */
export function LanguageTab({ projectId, dateRange }: LanguageTabProps) {
  const [dimension, setDimension] = useState<LanguageDimension>('content');

  const input = {
    projectId,
    from: dateRange.from,
    to: dateRange.to,
    dimension,
  };

  const key = (name: string) => [
    name,
    projectId,
    dimension,
    dateRange.from?.toISOString(),
    dateRange.to?.toISOString(),
  ];

  const performance = useQuery({
    queryKey: key('language-performance'),
    queryFn: () => getLanguagePerformanceAction(input),
  });

  const matrix = useQuery({
    queryKey: key('platform-language-matrix'),
    queryFn: () => getPlatformLanguageMatrixAction(input),
  });

  // Shorts against long-form is not a language question, so it does not
  // follow the toggle — and is not refetched when the toggle moves.
  const contentType = useQuery({
    queryKey: [
      'content-type-comparison',
      projectId,
      dateRange.from?.toISOString(),
      dateRange.to?.toISOString(),
    ],
    queryFn: () =>
      getContentTypeComparisonAction({
        projectId,
        from: dateRange.from,
        to: dateRange.to,
      }),
  });

  const shorts = useQuery({
    queryKey: key('shorts-performance'),
    queryFn: () => getShortsSourcePerformanceAction(input),
  });

  const geography = useQuery({
    queryKey: key('geography-by-language'),
    queryFn: () => getGeographyByLanguageAction(input),
  });

  const trend = useQuery({
    queryKey: key('language-trend'),
    queryFn: () => getLanguageTrendAction(input),
  });

  const divergence = useQuery({
    queryKey: ['language-divergence', projectId],
    queryFn: () => getLanguageDivergenceAction({ projectId }),
  });

  const isLoading =
    performance.isLoading ||
    matrix.isLoading ||
    contentType.isLoading ||
    shorts.isLoading ||
    geography.isLoading ||
    trend.isLoading;

  return (
    <div className="space-y-6">
      <div
        className="flex flex-col gap-3 rounded-lg border p-4"
        data-test="language-dimension"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium">Group languages by</span>

          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={dimension}
            onValueChange={(next) =>
              next && setDimension(resolveLanguageDimension(next))
            }
          >
            {LANGUAGE_DIMENSIONS.map((option) => (
              <ToggleGroupItem
                key={option}
                value={option}
                data-test={`language-dimension-${option}`}
              >
                {LANGUAGE_DIMENSION_LABELS[option]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <p
          className="text-sm text-muted-foreground"
          data-test="language-dimension-description"
        >
          {LANGUAGE_DIMENSION_DESCRIPTIONS[dimension]}
        </p>

        {divergence.data ? (
          <LanguageDivergenceNote divergence={divergence.data} />
        ) : null}
      </div>

      {isLoading ? (
        <LanguageAnalyticsDashboardSkeleton />
      ) : (
        <LanguageAnalyticsDashboard
          projectId={projectId}
          dimension={dimension}
          languageData={performance.data ?? null}
          matrixData={matrix.data ?? null}
          contentTypeData={contentType.data ?? null}
          shortsData={shorts.data ?? null}
          geographyData={geography.data ?? null}
          trendData={trend.data ?? null}
        />
      )}
    </div>
  );
}

/**
 * How far apart the two settings of the toggle are for this project.
 *
 * A count, not a warning: a channel carrying two languages can be exactly
 * what was intended. What it must not be is invisible, because it is the
 * reason the two settings above show different numbers.
 */
function LanguageDivergenceNote({
  divergence,
}: {
  divergence: LanguageDivergence;
}) {
  if (divergence.totalVideos === 0) return null;

  return (
    <div
      className="flex flex-col gap-1 border-t pt-3 text-sm"
      data-test="language-divergence"
    >
      <p>
        <span
          className="font-medium tabular-nums"
          data-test="language-divergence-count"
        >
          {divergence.divergentVideos}
        </span>{' '}
        of{' '}
        <span className="tabular-nums" data-test="language-divergence-total">
          {divergence.comparableVideos}
        </span>{' '}
        videos with both languages known are in a language other than their
        channel&apos;s target.
      </p>

      {divergence.divergentPairs.length > 0 ? (
        <ul className="text-muted-foreground">
          {divergence.divergentPairs.slice(0, 5).map((pair) => (
            <li
              key={`${pair.language}:${pair.channelLanguage}`}
              data-test={`language-divergence-pair-${pair.language}-${pair.channelLanguage}`}
            >
              {languageName(pair.language)} on a channel targeting{' '}
              {languageName(pair.channelLanguage)} ·{' '}
              <span className="tabular-nums">{pair.videoCount}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {divergence.contentNotSetVideos > 0 ||
      divergence.channelNotSetVideos > 0 ? (
        <p
          className="text-muted-foreground"
          data-test="language-divergence-not-set"
        >
          Not compared:{' '}
          <span className="tabular-nums">{divergence.contentNotSetVideos}</span>{' '}
          with no language set,{' '}
          <span className="tabular-nums">{divergence.channelNotSetVideos}</span>{' '}
          with no channel target.
        </p>
      ) : null}
    </div>
  );
}
