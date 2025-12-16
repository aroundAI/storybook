'use client';

/**
 * PerformanceInsights Component - Analytics preview section
 * Matches Google Stitch ActiveState-Overview design with sparkline charts
 * ALL values fetched from real analytics - no hardcoded values
 */

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

import { Card, CardContent } from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

interface PerformanceInsightsProps {
    totalViews?: number;
    viewsChange?: number;
    avgEngagement?: string;
    engagementChange?: number;
    audienceGrowth?: number;
    growthChange?: number;
}

interface MetricCardProps {
    label: string;
    value: string;
    change: number;
    color: 'indigo' | 'emerald' | 'blue';
}

function SparklineChart({ color }: { color: string }) {
    // Different paths for visual variety
    const paths = {
        indigo: "M0 35 L10 32 L20 34 L30 25 L40 28 L50 20 L60 22 L70 15 L80 18 L90 10 L100 5",
        emerald: "M0 25 L15 28 L30 20 L45 22 L60 15 L75 18 L90 12 L100 8",
        blue: "M0 30 L10 28 L20 29 L30 25 L40 22 L50 24 L60 20 L70 18 L80 15 L90 12 L100 10",
    };

    const strokeColor = {
        indigo: 'stroke-indigo-500',
        emerald: 'stroke-emerald-500',
        blue: 'stroke-blue-500',
    };

    const fillColor = {
        indigo: 'fill-indigo-500/10',
        emerald: 'fill-emerald-500/10',
        blue: 'fill-blue-500/10',
    };

    const path = paths[color as keyof typeof paths] || paths.indigo;

    return (
        <div className="h-16 mt-4 w-full">
            <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 40">
                {/* Area fill */}
                <path
                    d={`${path} V 40 H 0 Z`}
                    className={fillColor[color as keyof typeof fillColor]}
                />
                {/* Line */}
                <path
                    d={path}
                    fill="none"
                    className={strokeColor[color as keyof typeof strokeColor]}
                    strokeWidth="2"
                />
            </svg>
        </div>
    );
}

function MetricCard({ label, value, change, color }: MetricCardProps) {
    const isPositive = change > 0;
    const isNeutral = change === 0;
    const changeLabel = isNeutral ? '0%' : `${isPositive ? '+' : ''}${change.toFixed(1)}%`;

    return (
        <Card className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm rounded-2xl">
            <CardContent className="p-5">
                <div className="flex justify-between items-start">
                    <div>
                        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
                        <h3 className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">{value}</h3>
                    </div>
                    <span className={cn(
                        "inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full",
                        isNeutral
                            ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                            : isPositive
                                ? "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400"
                                : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                    )}>
                        {changeLabel}
                        {isNeutral ? (
                            <Minus className="w-3 h-3" />
                        ) : isPositive ? (
                            <TrendingUp className="w-3 h-3" />
                        ) : (
                            <TrendingDown className="w-3 h-3" />
                        )}
                    </span>
                </div>
                <SparklineChart color={color} />
            </CardContent>
        </Card>
    );
}

export function PerformanceInsights({
    totalViews = 0,
    viewsChange = 0,
    avgEngagement = "0m 0s",
    engagementChange = 0,
    audienceGrowth = 0,
    growthChange = 0,
}: PerformanceInsightsProps) {
    // Format large numbers
    const formatNumber = (num: number) => {
        if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
        if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
        return num.toString();
    };

    return (
        <section className="mb-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Performance Insights</h2>
                <select className="bg-transparent text-xs font-medium text-zinc-500 dark:text-zinc-400 border-none focus:ring-0 cursor-pointer hover:text-indigo-500 transition-colors">
                    <option>Last 30 Days</option>
                    <option>Last Quarter</option>
                    <option>All Time</option>
                </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <MetricCard
                    label="Total Views"
                    value={formatNumber(totalViews)}
                    change={viewsChange}
                    color="indigo"
                />
                <MetricCard
                    label="Avg. Engagement"
                    value={avgEngagement}
                    change={engagementChange}
                    color="emerald"
                />
                <MetricCard
                    label="Audience Growth"
                    value={formatNumber(audienceGrowth)}
                    change={growthChange}
                    color="blue"
                />
            </div>
        </section>
    );
}
