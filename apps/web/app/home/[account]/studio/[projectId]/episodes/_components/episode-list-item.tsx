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
        screenplay: episode.screenplayData?.scenes ? 'complete' : episode.storyData?.fullStory ? 'in-progress' : 'empty',
        shots: episode.shotList?.shots ? 'complete' : episode.screenplayData?.scenes ? 'in-progress' : 'empty',
    } as const;
}

function getStatusBadgeConfig(stage: 'story' | 'screenplay' | 'shots', status: 'complete' | 'in-progress' | 'empty') {
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
    const hasProgress = stages.story === 'complete' || stages.screenplay === 'complete' || stages.shots === 'complete';
    const isActive = hasProgress || stages.screenplay === 'in-progress' || stages.shots === 'in-progress';

    return (
        <div className={cn(
            "relative pl-14 pb-10 group",
            // Timeline line
            !isLast && "before:content-[''] before:absolute before:top-10 before:bottom-0 before:left-5 before:w-0.5 before:bg-zinc-200 dark:before:bg-zinc-700"
        )}>
            {/* Number circle */}
            <div className={cn(
                "absolute left-0 top-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shadow-sm z-10 transition-colors",
                isActive
                    ? "bg-white dark:bg-zinc-900 border-2 border-indigo-500 text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/30"
                    : "bg-white dark:bg-zinc-900 border-2 border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 group-hover:border-indigo-400 group-hover:text-indigo-500"
            )}>
                {String(episode.number).padStart(2, '0')}
            </div>

            {/* Episode card */}
            <Link href={href}>
                <div className="bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg p-5 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md transition-all cursor-pointer">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        {/* Content */}
                        <div className="flex-1">
                            <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-1">
                                {episode.title}
                            </h3>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
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
                                                'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                                                config.bgColor,
                                                config.textColor
                                            )}
                                        >
                                            <span className={cn('w-1.5 h-1.5 rounded-full mr-1.5', config.dotColor)} />
                                            {config.label}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-4 border-t md:border-t-0 md:border-l border-zinc-200 dark:border-zinc-700 pt-3 md:pt-0 md:pl-6 mt-2 md:mt-0">
                            <button className="p-2 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                <Pencil className="w-5 h-5" />
                            </button>
                            <button className="p-2 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* Progress bars */}
                    <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700 grid grid-cols-3 gap-2">
                        {(['story', 'screenplay', 'shots'] as const).map((stage) => (
                            <div key={stage} className="h-1 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden">
                                <div className={cn(
                                    'h-full rounded-full transition-all',
                                    getProgressColor(stages[stage]),
                                    stages[stage] === 'complete' && 'w-full',
                                    stages[stage] === 'in-progress' && 'w-1/2',
                                    stages[stage] === 'empty' && 'w-0'
                                )} />
                            </div>
                        ))}
                    </div>
                </div>
            </Link>
        </div>
    );
}
