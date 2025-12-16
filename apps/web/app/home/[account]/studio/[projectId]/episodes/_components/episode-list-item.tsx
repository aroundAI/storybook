'use client';

import Link from 'next/link';

import { ChevronRight, Pencil } from 'lucide-react';

import type { Episode } from '@kit/episodes/types';
import { cn } from '@kit/ui/utils';

interface EpisodeListItemProps {
  episode: Episode;
  account: string;
  projectId: string;
  isFirst?: boolean;
  isLast?: boolean;
}

function getStageStatus(episode: Episode) {
  return {
    story: episode.storyData?.fullStory ? 'complete' : 'empty',
    screenplay: episode.screenplayData?.scenes
      ? 'complete'
      : episode.storyData?.fullStory
        ? 'in-progress'
        : 'empty',
    shots: episode.shotList?.shots
      ? 'complete'
      : episode.screenplayData?.scenes
        ? 'in-progress'
        : 'empty',
  } as const;
}

function getStatusBadgeConfig(
  stage: 'story' | 'screenplay' | 'shots',
  status: 'complete' | 'in-progress' | 'empty',
) {
  const labels = {
    story: 'Story',
    screenplay: 'Screenplay',
    shots: 'Visuals',
  };

  if (status === 'complete') {
    return {
      label: `${labels[stage]}: Done`,
      dotColor: 'bg-green-500',
      bgColor: 'bg-green-100 dark:bg-green-900/30',
      textColor: 'text-green-800 dark:text-green-300',
    };
  }
  if (status === 'in-progress') {
    return {
      label: `${labels[stage]}: In Progress`,
      dotColor: 'bg-blue-500',
      bgColor: 'bg-blue-100 dark:bg-blue-900/30',
      textColor: 'text-blue-800 dark:text-blue-300',
    };
  }
  return {
    label: `${labels[stage]}: Pending`,
    dotColor: 'bg-zinc-400',
    bgColor: 'bg-zinc-100 dark:bg-zinc-700',
    textColor: 'text-zinc-600 dark:text-zinc-300',
  };
}

function getProgressColor(status: 'complete' | 'in-progress' | 'empty') {
  if (status === 'complete') return 'bg-green-500';
  if (status === 'in-progress') return 'bg-blue-500';
  return 'bg-zinc-200 dark:bg-zinc-700';
}

export function EpisodeListItem({
  episode,
  account,
  projectId,
  isFirst: _isFirst = false,
  isLast = false,
}: EpisodeListItemProps) {
  const href = `/home/${account}/studio/${projectId}/episodes/${episode.id}`;
  const stages = getStageStatus(episode);

  // Determine if this episode is active (has any progress)
  const hasProgress =
    stages.story === 'complete' ||
    stages.screenplay === 'complete' ||
    stages.shots === 'complete';
  const isActive =
    hasProgress ||
    stages.screenplay === 'in-progress' ||
    stages.shots === 'in-progress';

  return (
    <div
      className={cn(
        'group relative pb-10 pl-14',
        // Timeline line
        !isLast &&
          "before:absolute before:top-10 before:bottom-0 before:left-5 before:w-0.5 before:bg-zinc-200 before:content-[''] dark:before:bg-zinc-700",
      )}
    >
      {/* Number circle */}
      <div
        className={cn(
          'absolute top-0 left-0 z-10 flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold shadow-sm transition-colors',
          isActive
            ? 'border-2 border-indigo-500 bg-white text-indigo-600 group-hover:bg-indigo-50 dark:bg-zinc-900 dark:text-indigo-400 dark:group-hover:bg-indigo-900/30'
            : 'border-2 border-zinc-300 bg-white text-zinc-500 group-hover:border-indigo-400 group-hover:text-indigo-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-400',
        )}
      >
        {String(episode.number).padStart(2, '0')}
      </div>

      {/* Episode card */}
      <Link href={href}>
        <div className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-5 transition-all hover:border-indigo-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:border-indigo-700">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            {/* Content */}
            <div className="flex-1">
              <h3 className="mb-1 text-lg font-bold text-zinc-900 dark:text-white">
                {episode.title}
              </h3>
              <div className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                Updated {new Date(episode.updatedAt).toLocaleDateString()}
              </div>

              {/* Status badges */}
              <div className="flex flex-wrap gap-2">
                {(['story', 'screenplay', 'shots'] as const).map((stage) => {
                  const config = getStatusBadgeConfig(stage, stages[stage]);
                  return (
                    <span
                      key={stage}
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        config.bgColor,
                        config.textColor,
                      )}
                    >
                      <span
                        className={cn(
                          'mr-1.5 h-1.5 w-1.5 rounded-full',
                          config.dotColor,
                        )}
                      />
                      {config.label}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="mt-2 flex items-center gap-4 border-t border-zinc-200 pt-3 md:mt-0 md:border-t-0 md:border-l md:pt-0 md:pl-6 dark:border-zinc-700">
              <button className="p-2 text-zinc-400 transition-colors hover:text-indigo-600 dark:hover:text-indigo-400">
                <Pencil className="h-5 w-5" />
              </button>
              <button className="p-2 text-zinc-400 transition-colors hover:text-indigo-600 dark:hover:text-indigo-400">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Progress bars */}
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
            {(['story', 'screenplay', 'shots'] as const).map((stage) => (
              <div
                key={stage}
                className="h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-700"
              >
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    getProgressColor(stages[stage]),
                    stages[stage] === 'complete' && 'w-full',
                    stages[stage] === 'in-progress' && 'w-1/2',
                    stages[stage] === 'empty' && 'w-0',
                  )}
                />
              </div>
            ))}
          </div>
        </div>
      </Link>
    </div>
  );
}
