'use client';

import {
    ContentTypeCard,
    ContentTypeCardSkeleton,
    LanguagePerformanceCard,
    LanguagePerformanceCardSkeleton,
    PlatformLanguageMatrix,
    PlatformLanguageMatrixSkeleton,
} from './language-analytics-cards';
import {
    LanguageTrendChart,
    LanguageTrendChartSkeleton,
} from './language-trend-chart';
import {
    TopShortsCard,
    TopShortsCardSkeleton,
    LanguageGeographyCard,
    LanguageGeographyCardSkeleton,
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
 * - Top performing shorts (Phase 3)
 * - Geography by language (Phase 4)
 */
export function LanguageAnalyticsDashboard({
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

            {/* Row 4: Shorts + Geography */}
            <div className="grid gap-6 md:grid-cols-2">
                <TopShortsCard data={shortsData || []} />
                <LanguageGeographyCard data={geographyData || []} />
            </div>
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
            <div className="grid gap-6 md:grid-cols-2">
                <TopShortsCardSkeleton />
                <LanguageGeographyCardSkeleton />
            </div>
        </div>
    );
}
