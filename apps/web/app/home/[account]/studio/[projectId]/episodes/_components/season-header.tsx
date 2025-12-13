'use client';

import { Sparkles } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Progress } from '@kit/ui/progress';


interface SeasonHeaderProps {
    seasonNumber: number;
    seasonName?: string;
    totalEpisodes: number;
    completedEpisodes: number;
    inProgressEpisodes: number;
    onGenerateSeason?: () => void;
}

export function SeasonHeader({
    seasonNumber,
    seasonName,
    totalEpisodes,
    completedEpisodes,
    inProgressEpisodes,
    onGenerateSeason,
}: SeasonHeaderProps) {
    const progressPercent = (completedEpisodes / totalEpisodes) * 100;
    const hasIncompleteEpisodes = completedEpisodes < totalEpisodes;

    return (
        <div className="relative overflow-hidden rounded-xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-indigo-500/5 to-background p-8">
            {/* Subtle pattern background */}
            <div
                className="absolute inset-0 opacity-[0.02]"
                style={{
                    backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
                    backgroundSize: '40px 40px',
                }}
            />

            <div className="relative flex items-start justify-between gap-6">
                {/* Left: Season Info */}
                <div className="flex-1 space-y-4">
                    {/* Season Title */}
                    <div className="flex items-center gap-4">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-indigo-500/30 bg-indigo-500/10">
                            <Sparkles className="h-8 w-8 text-indigo-500" />
                        </div>
                        <div>
                            <h2 className="text-4xl font-bold tracking-tight">
                                Season {seasonNumber}
                                {seasonName && (
                                    <span className="text-muted-foreground ml-2 text-2xl font-normal">
                                        {seasonName}
                                    </span>
                                )}
                            </h2>
                            <div className="mt-2 flex items-center gap-3 text-sm">
                                <span className="text-muted-foreground font-medium">
                                    {totalEpisodes} {totalEpisodes === 1 ? 'episode' : 'episodes'}
                                </span>
                                <span className="text-muted-foreground">•</span>
                                {completedEpisodes > 0 && (
                                    <>
                                        <Badge variant="secondary" className="bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-300">
                                            {completedEpisodes} Complete
                                        </Badge>
                                    </>
                                )}
                                {inProgressEpisodes > 0 && (
                                    <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                                        {inProgressEpisodes} In Progress
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground font-medium">Season Progress</span>
                            <span className="text-foreground font-semibold">{Math.round(progressPercent)}%</span>
                        </div>
                        <Progress value={progressPercent} className="h-2" />
                    </div>
                </div>

                {/* Right: Action */}
                {hasIncompleteEpisodes && onGenerateSeason && (
                    <Button
                        onClick={onGenerateSeason}
                        size="lg"
                        className="shrink-0 gap-2 bg-indigo-600 hover:bg-indigo-700"
                    >
                        <Sparkles className="h-4 w-4" />
                        Generate Remaining Episodes
                    </Button>
                )}
            </div>
        </div>
    );
}
