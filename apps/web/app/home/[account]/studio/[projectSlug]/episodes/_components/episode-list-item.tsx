'use client';

import Link from 'next/link';

import { ChevronRight, Pencil } from 'lucide-react';

import type { Episode } from '@kit/episodes/types';
import { cn } from '@kit/ui/utils';

interface EpisodeListItemProps {
  episode: Episode;
  account: string;
  projectSlug: string;
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
  if (status === 'complete') return 'bg-green-400';
  if (status === 'in-progress') return 'bg-blue-400';
  return 'bg-slate-500';
}

export function EpisodeListItem({
  episode,
  account,
  projectSlug,
  isFirst: _isFirst = false,
  isLast: _isLast = false,
}: EpisodeListItemProps) {
  const href = `/home/${account}/studio/${projectSlug}/episodes/${episode.slug ?? episode.id}`;
  const stages = getStageStatus(episode);

  return (
    <div className="group flex items-start gap-4">
      {/* Number circle - floating with gradient */}
      <div className="relative z-10 mt-4 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-sm font-semibold text-slate-300 ring-1 ring-white/10">
        {String(episode.number).padStart(2, '0')}
      </div>

      {/* Episode card - glass panel */}
      <Link href={href} className="flex-1">
        <div className="cursor-pointer rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-white/[0.05] hover:shadow-lg">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">
                {episode.title}
              </h3>
              <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
                Updated {new Date(episode.updatedAt).toLocaleDateString()}
              </p>

              {/* Status badges - cinema badges */}
              <div className="flex flex-wrap gap-2 text-[10px]">
                {(['story', 'screenplay', 'visuals'] as const).map((stage) => (
                  <span
                    key={stage}
                    className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-0.5 text-slate-400 backdrop-blur-sm"
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
