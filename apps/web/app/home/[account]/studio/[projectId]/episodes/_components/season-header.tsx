'use client';

import { ChevronDown, ChevronUp, FolderOpen } from 'lucide-react';

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
    <div className="flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
      <div className="flex items-center gap-4">
        {/* Icon */}
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-800 dark:text-blue-300">
          <FolderOpen className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            Season {seasonNumber}
            {seasonName && (
              <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                {seasonName}
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {totalEpisodes} {totalEpisodes === 1 ? 'episode' : 'episodes'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Completion percentage */}
        <div className="text-right">
          <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
            {progressPercent}%
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Complete
          </div>
        </div>

        {/* Collapse/Expand toggle */}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
        >
          {isCollapsed ? (
            <ChevronDown className="h-6 w-6" />
          ) : (
            <ChevronUp className="h-6 w-6" />
          )}
        </button>
      </div>
    </div>
  );
}
