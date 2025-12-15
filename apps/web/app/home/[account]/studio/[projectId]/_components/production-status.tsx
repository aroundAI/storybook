'use client';

/**
 * ProductionStatus Component - Production Health Widget
 *
 * "Meter" style thin progress bars (h-1.5) for a technical look.
 * Uses Zinc-900 cards with white/5 borders in dark mode.
 */

import Link from 'next/link';

import { ArrowRight, FileText, Film, Sparkles } from 'lucide-react';

import { Card, CardContent, CardHeader } from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

interface ProductionStatusProps {
    scriptsComplete: number;
    storyboardsComplete: number;
    visualsComplete: number;
    totalEpisodes: number;
    baseUrl: string;
}

interface MeterRowProps {
    label: string;
    value: number;
    total: number;
    icon: React.ComponentType<{ className?: string }>;
    fillColor: string;
    iconColor: string;
}

function MeterRow({ label, value, total, icon: Icon, fillColor, iconColor }: MeterRowProps) {
    const percentage = total > 0 ? Math.round((value / total) * 100) : 0;

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Icon className={cn('h-4 w-4', iconColor)} />
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
                </div>
                <span className="text-sm font-bold text-zinc-900 dark:text-white">{percentage}%</span>
            </div>
            {/* Meter style - thin bar */}
            <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full">
                <div
                    className={cn('h-full rounded-full transition-all duration-500', fillColor)}
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
}

export function ProductionStatus({
    scriptsComplete,
    storyboardsComplete,
    visualsComplete,
    totalEpisodes,
    baseUrl,
}: ProductionStatusProps) {
    // Calculate overall progress
    const totalComplete = scriptsComplete + storyboardsComplete + visualsComplete;
    const maxProgress = totalEpisodes * 3;
    const overallPercentage = maxProgress > 0
        ? Math.round((totalComplete / maxProgress) * 100)
        : 0;

    // Empty state
    if (totalEpisodes === 0) {
        return (
            <Card className="bg-white dark:bg-[#18181B] border border-zinc-200 dark:border-white/5 shadow-sm">
                <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-indigo-500" />
                        <span className="text-sm font-semibold text-zinc-900 dark:text-white tracking-tight">Production Health</span>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <Film className="h-8 w-8 text-zinc-400 mb-3" />
                        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No episodes yet</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="bg-white dark:bg-[#18181B] border border-zinc-200 dark:border-white/5 shadow-sm">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-indigo-500" />
                        <span className="text-sm font-semibold text-zinc-900 dark:text-white tracking-tight">Production Health</span>
                    </div>
                    <div className="text-right">
                        <span className="text-2xl font-bold text-indigo-500">{overallPercentage}%</span>
                        <p className="text-[10px] uppercase text-zinc-500 font-bold tracking-wider">Overall</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Scripting - Amber */}
                <MeterRow
                    label="Scripting"
                    value={scriptsComplete}
                    total={totalEpisodes}
                    icon={FileText}
                    fillColor="bg-amber-500"
                    iconColor="text-amber-500"
                />

                {/* Storyboards - Purple */}
                <MeterRow
                    label="Storyboards"
                    value={storyboardsComplete}
                    total={totalEpisodes}
                    icon={Film}
                    fillColor="bg-purple-500"
                    iconColor="text-purple-500"
                />

                {/* Animation - Indigo */}
                <MeterRow
                    label="Animation"
                    value={visualsComplete}
                    total={totalEpisodes}
                    icon={Sparkles}
                    fillColor="bg-indigo-500"
                    iconColor="text-indigo-500"
                />

                {/* Link */}
                <Link
                    href={`${baseUrl}/episodes`}
                    className="flex items-center justify-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors pt-3 border-t border-zinc-100 dark:border-white/5"
                >
                    View All Episodes
                    <ArrowRight className="h-3 w-3" />
                </Link>
            </CardContent>
        </Card>
    );
}
