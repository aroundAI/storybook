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
    story: episode.storyData?.fullStory ? 'complete' : 'pending',
    screenplay: episode.screenplayData?.scenes
      ? 'complete'
      : episode.storyData?.fullStory
        ? 'in-progress'
        : 'pending',
    visuals: episode.shotList?.shots
      ? 'complete'
      : episode.screenplayData?.scenes
        ? 'in-progress'
        : 'pending',
  } as const;
}

function getStatusLabel(
  stage: 'story' | 'screenplay' | 'visuals',
  status: 'complete' | 'in-progress' | 'pending',
) {
  const labels = {
    story: 'Story',
    screenplay: 'Screenplay',
    visuals: 'Visuals',
  };

  const statusLabels = {
    complete: 'Done',
    'in-progress': 'In Progress',
    pending: 'Pending',
  };

  return `${labels[stage]}: ${statusLabels[status]}`;
}

function getStatusDotColor(status: 'complete' | 'in-progress' | 'pending') {
  if (status === 'complete') return 'bg-green-500';
  if (status === 'in-progress') return 'bg-blue-500';
  return 'bg-gray-400';
}

export function EpisodeListItem({
  episode,
  account,
  projectId,
  isFirst: _isFirst = false,
  isLast: _isLast = false,
}: EpisodeListItemProps) {
  const href = `/home/${account}/studio/${projectId}/episodes/${episode.id}`;
  const stages = getStageStatus(episode);

  return (
    <div className="group flex items-start gap-4">
      {/* Number circle */}
      <div className="relative z-10 mt-4 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
        {String(episode.number).padStart(2, '0')}
      </div>

      {/* Episode card */}
      <Link href={href} className="flex-1">
        <div className="cursor-pointer rounded-lg border border-gray-200 bg-white p-4 transition-all hover:border-blue-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-700">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">
                {episode.title}
              </h3>
              <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
                Updated {new Date(episode.updatedAt).toLocaleDateString()}
              </p>

              {/* Status badges */}
              <div className="flex gap-2 text-[10px] font-medium text-gray-500 dark:text-gray-400">
                {(['story', 'screenplay', 'visuals'] as const).map((stage) => (
                  <span
                    key={stage}
                    className="flex items-center gap-1 rounded border border-gray-100 bg-gray-100 px-2 py-0.5 dark:border-gray-700 dark:bg-gray-800"
                  >
                    <div
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        getStatusDotColor(stages[stage]),
                      )}
                    />
                    {getStatusLabel(stage, stages[stage])}
                  </span>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
              <button className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300">
                <Pencil className="h-4 w-4" />
              </button>
              <button className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}
