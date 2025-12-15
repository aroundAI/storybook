'use client';

/**
 * RecentEpisodes Component - Jump Back In Widget
 *
 * Table rows with 16:9 widescreen thumbnails, status badges, and proper borders.
 * Uses real Unsplash placeholders for high-fidelity look.
 */

import Link from 'next/link';

import { formatDistanceToNow } from 'date-fns';
import { ArrowRight, Clapperboard, Film, Sparkles } from 'lucide-react';

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
}

interface RecentEpisodesProps {
    episodes: Episode[];
    baseUrl: string;
}

// Default Unsplash thumbnail for cinematic look (16:9 aspect)
const DEFAULT_THUMBNAIL = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=400&auto=format&fit=crop';

// Status badge config
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
    draft: { label: 'Draft', className: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
    story: { label: 'Story', className: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
    screenplay: { label: 'Screenplay', className: 'bg-purple-500/10 text-purple-500 border-purple-500/20' },
    shots: { label: 'Shot List', className: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
    visual: { label: 'Rendering', className: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20' },
    audio: { label: 'Audio', className: 'bg-pink-500/10 text-pink-500 border-pink-500/20' },
    complete: { label: 'Complete', className: 'bg-green-500/10 text-green-500 border-green-500/20' },
};

export function RecentEpisodes({ episodes, baseUrl }: RecentEpisodesProps) {
    // Empty state
    if (episodes.length === 0) {
        return (
            <Card className="bg-white dark:bg-[#18181B] border border-zinc-200 dark:border-white/5 shadow-sm">
                <CardHeader className="pb-3">
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
                        <Button asChild className="bg-white text-zinc-900 hover:bg-zinc-200 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
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
        <Card className="bg-white dark:bg-[#18181B] border border-zinc-200 dark:border-white/5 shadow-sm">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Clapperboard className="h-4 w-4 text-indigo-500" />
                        <span className="text-sm font-semibold text-zinc-900 dark:text-white tracking-tight">Jump Back In</span>
                    </div>
                    <Button variant="ghost" size="sm" asChild className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                        <Link href={`${baseUrl}/episodes`}>
                            View All
                            <ArrowRight className="ml-1 h-3 w-3" />
                        </Link>
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                {/* Table Rows */}
                <div>
                    {episodes.map((episode, index) => {
                        const stage = episode.stage ?? 'draft';
                        const statusConfig = STATUS_CONFIG[stage] ?? STATUS_CONFIG.draft!;
                        const thumbnail = episode.thumbnailUrl || DEFAULT_THUMBNAIL;

                        return (
                            <Link
                                key={episode.id}
                                href={`${baseUrl}/episodes/${episode.id}`}
                                className={cn(
                                    'flex items-center gap-4 p-3 transition',
                                    'border-b border-zinc-100 dark:border-zinc-800/50',
                                    'hover:bg-zinc-50 dark:hover:bg-white/5',
                                    index === episodes.length - 1 && 'border-b-0'
                                )}
                            >
                                {/* Thumbnail - 16:9 widescreen (CRITICAL) */}
                                <div className="w-24 aspect-video rounded bg-zinc-800 overflow-hidden border border-zinc-700 shrink-0">
                                    <img
                                        src={thumbnail}
                                        alt=""
                                        className="w-full h-full object-cover"
                                    />
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                        {episode.title || `Episode ${episode.number}`}
                                    </p>
                                    <p className="text-xs text-zinc-500">
                                        EP{String(episode.number).padStart(2, '0')}
                                    </p>
                                </div>

                                {/* Status Badge */}
                                <span className={cn(
                                    'px-2 py-0.5 text-[10px] font-bold border rounded-full shrink-0',
                                    statusConfig.className
                                )}>
                                    {statusConfig.label}
                                </span>

                                {/* Time */}
                                <span className="text-xs text-zinc-400 shrink-0 w-20 text-right">
                                    {formatDistanceToNow(new Date(episode.updated_at), { addSuffix: false })}
                                </span>
                            </Link>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}
