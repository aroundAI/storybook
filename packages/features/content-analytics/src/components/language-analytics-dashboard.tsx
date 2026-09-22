'use client';

import type { LanguageDimension } from '@kit/clickhouse';

import type {
  ContentTypeComparison,
  GeographyByLanguage,
  LanguagePerformance,
  LanguageTrendEntry,
  PlatformLanguageEntry,
  ShortsSourcePerformance,
} from '../server/language-analytics';
import {
  BestEpisodesToClipCard,
  BestEpisodesToClipCardSkeleton,
  LanguageComparisonChart,
  LanguageComparisonChartSkeleton,
  ShortsROICard,
  ShortsROICardSkeleton,
} from './analytics-enhancement-cards';
import {
  ContentTypeCard,
  ContentTypeCardSkeleton,
  LanguagePerformanceCard,
  LanguagePerformanceCardSkeleton,
  PlatformLanguageMatrix,
  PlatformLanguageMatrixSkeleton,
} from './language-analytics-cards';
import {
  GeographyHeatmapCard,
  GeographyHeatmapCardSkeleton,
  LanguageInsightsCard,
  LanguageInsightsCardSkeleton,
} from './language-insights-cards';
import {
  LanguageTrendChart,
  LanguageTrendChartSkeleton,
} from './language-trend-chart';
import { TopShortsCard, TopShortsCardSkeleton } from './shorts-geography-cards';

interface LanguageAnalyticsDashboardProps {
  projectId: string;
  /**
   * Which language every card below is grouped by (FILM-1702). Each card
   * names it, so none of them can be read under the wrong one.
   */
  dimension?: LanguageDimension;
  languageData: LanguagePerformance[] | null;
  matrixData: PlatformLanguageEntry[] | null;
  contentTypeData: ContentTypeComparison | null;
  shortsData?: ShortsSourcePerformance[] | null;
  geographyData?: GeographyByLanguage[] | null;
  trendData?: LanguageTrendEntry[] | null;
  isLoading?: boolean;
}

/**
 * Complete Language Analytics Dashboard
 *
 * Displays:
 * - Language performance breakdown
 * - Platform × Language matrix
 * - Shorts vs Long-form comparison
 * - Language trend chart (time-series)
 * - Top performing shorts
 * - Language comparison chart (Phase 3)
 * - Shorts ROI calculator (Phase 3)
 * - Best episodes recommendations (Phase 3)
 * - Geography heatmap (Phase 4)
 * - AI Language Insights (Phase 4)
 */
export function LanguageAnalyticsDashboard({
  projectId,
  dimension = 'content',
  languageData,
  matrixData,
  contentTypeData,
  shortsData,
  geographyData,
  trendData,
  isLoading = false,
}: LanguageAnalyticsDashboardProps) {
  if (isLoading) {
    return <LanguageAnalyticsDashboardSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Row 1: Language Performance + Content Type */}
      <div className="grid gap-6 md:grid-cols-2">
        <LanguagePerformanceCard
          data={languageData || []}
          dimension={dimension}
        />
        <ContentTypeCard data={contentTypeData} />
      </div>

      {/* Row 2: Language Trend Chart */}
      <LanguageTrendChart data={trendData || []} dimension={dimension} />

      {/* Row 3: Platform × Language Matrix */}
      <PlatformLanguageMatrix data={matrixData || []} dimension={dimension} />

      {/* Row 4: Phase 3 Analytics Enhancements */}
      <div className="grid gap-6 md:grid-cols-3">
        <LanguageComparisonChart data={languageData} dimension={dimension} />
        <ShortsROICard contentTypeData={contentTypeData} />
        <BestEpisodesToClipCard
          languageData={languageData}
          contentTypeData={contentTypeData}
        />
      </div>

      {/* Row 5: Shorts + AI Insights */}
      <div className="grid gap-6 md:grid-cols-2">
        <TopShortsCard data={shortsData || []} dimension={dimension} />
        <LanguageInsightsCard projectId={projectId} />
      </div>

      {/* Row 6: Geography Heatmap */}
      <GeographyHeatmapCard data={geographyData || []} dimension={dimension} />
    </div>
  );
}

export function LanguageAnalyticsDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <LanguagePerformanceCardSkeleton />
        <ContentTypeCardSkeleton />
      </div>
      <LanguageTrendChartSkeleton />
      <PlatformLanguageMatrixSkeleton />
      <div className="grid gap-6 md:grid-cols-3">
        <LanguageComparisonChartSkeleton />
        <ShortsROICardSkeleton />
        <BestEpisodesToClipCardSkeleton />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <TopShortsCardSkeleton />
        <LanguageInsightsCardSkeleton />
      </div>
      <GeographyHeatmapCardSkeleton />
    </div>
  );
}
