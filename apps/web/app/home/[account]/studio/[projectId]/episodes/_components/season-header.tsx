'use client';

import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

interface SeasonAnalyticsSummary {
    totalViews: number;
    avgEngagementRate: number;
}

interface SeasonHeaderProps {
    seasonNumber: number;
    seasonName?: string;
    totalEpisodes: number;
    completedEpisodes: number;
    inProgressEpisodes: number;
    analytics?: SeasonAnalyticsSummary | null;
    onGenerateSeason?: () => void;
    isCollapsed?: boolean;
    onToggleCollapse?: () => void;
}

export function SeasonHeader({
    seasonNumber,
    seasonName,
    totalEpisodes,
    completedEpisodes,
    isCollapsed = false,
    onToggleCollapse,
}: SeasonHeaderProps) {
    const progressPercent = totalEpisodes > 0 ? Math.round((completedEpisodes / totalEpisodes) * 100) : 0;

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            {/* Header section with indigo tint - clickable to toggle */}
            <button
                type="button"
                onClick={onToggleCollapse}
                className="w-full bg-indigo-50 dark:bg-indigo-900/20 p-6 border-b border-indigo-100 dark:border-indigo-800/30 hover:bg-indigo-100/50 dark:hover:bg-indigo-900/30 transition-colors text-left cursor-pointer"
            >
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-4">
                        {/* Icon */}
                        <div className="w-12 h-12 rounded-lg bg-indigo-100 dark:bg-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-300">
                            <Sparkles className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-zinc-900 dark:text-white flex items-baseline gap-2">
                                Season {seasonNumber}
                                {seasonName && (
                                    <span className="text-base font-normal text-zinc-500 dark:text-zinc-400">
                                        {seasonName}
                                    </span>
                                )}
                            </h2>
                            <div className="text-sm text-zinc-500 dark:text-zinc-400">
                                {totalEpisodes} {totalEpisodes === 1 ? 'episode' : 'episodes'}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Completion percentage */}
                        <div className="text-right">
                            <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                                {progressPercent}%
                            </span>
                            <span className="text-xs text-zinc-500 dark:text-zinc-400 block uppercase tracking-wide font-semibold">
                                Complete
                            </span>
                        </div>

                        {/* Collapse/Expand toggle */}
                        <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-800/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                            {isCollapsed ? (
                                <ChevronDown className="w-5 h-5" />
                            ) : (
                                <ChevronUp className="w-5 h-5" />
                            )}
                        </div>
                    </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-indigo-200 dark:bg-indigo-900 rounded-full h-2 overflow-hidden">
                    <div
                        className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
            </button>
        </div>
    );
}
