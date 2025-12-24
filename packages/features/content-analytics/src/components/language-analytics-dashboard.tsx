'use client';

import {
    ContentTypeCard,
    ContentTypeCardSkeleton,
    LanguagePerformanceCard,
    LanguagePerformanceCardSkeleton,
    PlatformLanguageMatrix,
    PlatformLanguageMatrixSkeleton,
} from './language-analytics-cards';
import type {
    ContentTypeComparison,
    LanguagePerformance,
    PlatformLanguageEntry,
} from '../server/language-analytics';

interface LanguageAnalyticsDashboardProps {
    languageData: LanguagePerformance[] | null;
    matrixData: PlatformLanguageEntry[] | null;
    contentTypeData: ContentTypeComparison | null;
    isLoading?: boolean;
}

/**
 * Complete Language Analytics Dashboard
 *
 * Displays:
 * - Language performance breakdown
 * - Platform × Language matrix
 * - Shorts vs Long-form comparison
 */
export function LanguageAnalyticsDashboard({
    languageData,
    matrixData,
    contentTypeData,
    isLoading = false,
}: LanguageAnalyticsDashboardProps) {
    if (isLoading) {
        return <LanguageAnalyticsDashboardSkeleton />;
    }

    return (
        <div className="space-y-6">
            {/* Language Performance */}
            <div className="grid gap-6 md:grid-cols-2">
                <LanguagePerformanceCard data={languageData || []} />
                <ContentTypeCard data={contentTypeData} />
            </div>

            {/* Platform × Language Matrix */}
            <PlatformLanguageMatrix data={matrixData || []} />
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
            <PlatformLanguageMatrixSkeleton />
        </div>
    );
}
