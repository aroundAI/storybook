'use client';

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
import {
    TopShortsCard,
    TopShortsCardSkeleton,
} from './shorts-geography-cards';
import type {
    ContentTypeComparison,
    GeographyByLanguage,
    LanguagePerformance,
    LanguageTrendEntry,
    PlatformLanguageEntry,
    ShortsSourcePerformance,
} from '../server/language-analytics';

interface LanguageAnalyticsDashboardProps {
    projectId: string;
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
                <LanguagePerformanceCard data={languageData || []} />
                <ContentTypeCard data={contentTypeData} />
            </div>

            {/* Row 2: Language Trend Chart */}
            <LanguageTrendChart data={trendData || []} />

            {/* Row 3: Platform × Language Matrix */}
            <PlatformLanguageMatrix data={matrixData || []} />

            {/* Row 4: Phase 3 Analytics Enhancements */}
            <div className="grid gap-6 md:grid-cols-3">
                <LanguageComparisonChart data={languageData} />
                <ShortsROICard contentTypeData={contentTypeData} />
                <BestEpisodesToClipCard
                    languageData={languageData}
                    contentTypeData={contentTypeData}
                />
            </div>

            {/* Row 5: Shorts + AI Insights */}
            <div className="grid gap-6 md:grid-cols-2">
                <TopShortsCard data={shortsData || []} />
                <LanguageInsightsCard projectId={projectId} />
            </div>

            {/* Row 6: Geography Heatmap */}
            <GeographyHeatmapCard data={geographyData || []} />
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
