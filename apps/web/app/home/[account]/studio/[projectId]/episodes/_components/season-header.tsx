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
  const progressPercent =
    totalEpisodes > 0
      ? Math.round((completedEpisodes / totalEpisodes) * 100)
      : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Header section with indigo tint - clickable to toggle */}
      <button
        type="button"
        onClick={onToggleCollapse}
        className="w-full cursor-pointer border-b border-indigo-100 bg-indigo-50 p-6 text-left transition-colors hover:bg-indigo-100/50 dark:border-indigo-800/30 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/30"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Icon */}
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-800 dark:text-indigo-300">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h2 className="flex items-baseline gap-2 text-xl font-bold text-zinc-900 dark:text-white">
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
              <span className="block text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                Complete
              </span>
            </div>

            {/* Collapse/Expand toggle */}
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-800/50 dark:text-indigo-400">
              {isCollapsed ? (
                <ChevronDown className="h-5 w-5" />
              ) : (
                <ChevronUp className="h-5 w-5" />
              )}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-indigo-200 dark:bg-indigo-900">
          <div
            className="h-2 rounded-full bg-indigo-500 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </button>
    </div>
  );
}
