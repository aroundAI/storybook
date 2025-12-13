'use client';

/**
 * RecentEpisodes Component
 *
 * Shows the 3 most recently edited episodes with timestamps.
 */

import Link from 'next/link';

import { formatDistanceToNow } from 'date-fns';
import { Clapperboard, Clock, FileText } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

interface Episode {
    id: string;
    title: string;
    number: number;
    updated_at: string;
}

interface RecentEpisodesProps {
    episodes: Episode[];
    baseUrl: string;
}

export function RecentEpisodes({ episodes, baseUrl }: RecentEpisodesProps) {
    if (episodes.length === 0) {
        return (
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Clapperboard className="h-4 w-4" />
                        Jump Back In
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <FileText className="mb-2 h-8 w-8 text-muted-foreground/50" />
                        <p className="text-sm text-muted-foreground">
                            No episodes yet
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Create your first episode to get started
                        </p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <Clapperboard className="h-4 w-4" />
                    Jump Back In
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
                {episodes.map((episode) => (
                    <Link
                        key={episode.id}
                        href={`${baseUrl}/episodes/${episode.id}`}
                        className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-muted/50"
                    >
                        <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10 text-xs font-bold text-primary">
                                {episode.number}
                            </div>
                            <div>
                                <p className="font-medium text-sm line-clamp-1">
                                    {episode.title || `Episode ${episode.number}`}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span>
                                {formatDistanceToNow(new Date(episode.updated_at), {
                                    addSuffix: true,
                                })}
                            </span>
                        </div>
                    </Link>
                ))}
            </CardContent>
        </Card>
    );
}
