'use client';

/**
 * RecentEpisodes Component - Jump Back In Widget
 * Matches Google Stitch ActiveState-Overview design
 */

import Link from 'next/link';

import { formatDistanceToNow } from 'date-fns';
import { ArrowRight, Clapperboard, Film, Play, Sparkles } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader } from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

interface Episode {
    id: string;
    title: string;
    number: number;
    updated_at: string;
    stage?: 'draft' | 'story' | 'screenplay' | 'shots' | 'visual' | 'audio' | 'complete';
    thumbnailUrl?: string;
    seasonNumber?: number;
}

interface RecentEpisodesProps {
    episodes: Episode[];
    baseUrl: string;
}

// Gradient backgrounds for episodes without thumbnails
const GRADIENTS = [
    'from-indigo-400 to-purple-600',
    'from-blue-400 to-cyan-500',
    'from-pink-400 to-rose-500',
    'from-emerald-400 to-teal-500',
    'from-amber-400 to-orange-500',
];

// Status badge config with progress percentages
const STATUS_CONFIG: Record<string, { label: string; className: string; color: string; progress: number }> = {
    draft: { label: 'Draft', className: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800', color: 'bg-amber-400', progress: 15 },
    story: { label: 'Story', className: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800', color: 'bg-amber-400', progress: 33 },
    screenplay: { label: 'Screenplay', className: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800', color: 'bg-purple-500', progress: 50 },
    shots: { label: 'Shot List', className: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800', color: 'bg-blue-500', progress: 66 },
    visual: { label: 'Review', className: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800', color: 'bg-indigo-500', progress: 75 },
    audio: { label: 'Audio', className: 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400 border border-pink-200 dark:border-pink-800', color: 'bg-pink-500', progress: 90 },
    complete: { label: 'Complete', className: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800', color: 'bg-green-500', progress: 100 },
};

export function RecentEpisodes({ episodes, baseUrl }: RecentEpisodesProps) {
    // Empty state
    if (episodes.length === 0) {
        return (
            <Card className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm rounded-2xl">
                <CardHeader className="pb-3 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center gap-2">
                        <Clapperboard className="h-4 w-4 text-indigo-500" />
                        <span className="text-sm font-semibold text-zinc-900 dark:text-white tracking-tight">Jump Back In</span>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                        <div className="relative mb-4">
                            <div className="absolute inset-0 animate-pulse rounded-full bg-indigo-500/20 blur-lg" />
                            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-indigo-500/10 border border-indigo-500/20">
                                <Film className="h-8 w-8 text-indigo-500" />
                            </div>
                        </div>
                        <h3 className="font-semibold text-zinc-900 dark:text-white mb-1">Create Your First Episode</h3>
                        <p className="text-sm text-zinc-500 mb-4 max-w-xs">
                            Start your creative journey.
                        </p>
                        <Button asChild className="bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100">
                            <Link href={`${baseUrl}/episodes`}>
                                <Sparkles className="mr-2 h-4 w-4" />
                                Create Episode
                            </Link>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm rounded-2xl">
            <CardHeader className="pb-3 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Clapperboard className="h-4 w-4 text-indigo-500" />
                        <span className="text-lg font-semibold text-zinc-900 dark:text-white">Jump Back In</span>
                    </div>
                    <Button variant="ghost" size="sm" asChild className="text-sm text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium">
                        <Link href={`${baseUrl}/episodes`}>
                            View All
                            <ArrowRight className="ml-1 h-4 w-4" />
                        </Link>
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="p-2">
                <div className="space-y-1">
                    {episodes.map((episode, index) => {
                        const stage = episode.stage ?? 'draft';
                        const statusConfig = STATUS_CONFIG[stage] ?? STATUS_CONFIG.draft!;
                        const gradient = GRADIENTS[index % GRADIENTS.length];

                        return (
                            <Link
                                key={episode.id}
                                href={`${baseUrl}/episodes/${episode.id}`}
                                className="group flex items-center gap-4 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700"
                            >
                                {/* Thumbnail with gradient and play overlay */}
                                <div className={cn(
                                    `w-24 h-16 rounded-lg bg-gradient-to-br ${gradient} flex-shrink-0 relative overflow-hidden shadow-sm`
                                )}>
                                    {episode.thumbnailUrl ? (
                                        <img
                                            src={episode.thumbnailUrl}
                                            alt=""
                                            className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                                        />
                                    ) : (
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <Film className="w-6 h-6 text-white/60" />
                                        </div>
                                    )}
                                    {/* Play overlay on hover */}
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                                        <Play className="w-6 h-6 text-white fill-white drop-shadow-md" />
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start mb-0.5">
                                        <h3 className="font-semibold text-zinc-900 dark:text-white truncate">
                                            {episode.title || `Episode ${episode.number}`}
                                        </h3>
                                        <span className="text-xs text-zinc-400 whitespace-nowrap ml-2">
                                            {formatDistanceToNow(new Date(episode.updated_at), { addSuffix: false })}
                                        </span>
                                    </div>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                                        EP{String(episode.number).padStart(2, '0')} {episode.seasonNumber ? `• Season ${episode.seasonNumber}` : ''}
                                    </p>
                                    {/* Status badge and progress bar */}
                                    <div className="flex items-center gap-2">
                                        <span className={cn(
                                            'text-[10px] font-bold uppercase px-2 py-0.5 rounded-full',
                                            statusConfig.className
                                        )}>
                                            {statusConfig.label}
                                        </span>
                                        <div className="h-1 flex-1 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden max-w-[100px]">
                                            <div
                                                className={cn('h-full rounded-full transition-all', statusConfig.color)}
                                                style={{ width: `${statusConfig.progress}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}
