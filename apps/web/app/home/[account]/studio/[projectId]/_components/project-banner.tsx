'use client';

import { ArrowRight, Sparkles } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';

interface ProjectBannerProps {
    name: string;
    description: string;
    genre?: string;
    targetAudience?: string;
    onCreateCharacter?: () => void;
    onCreateEpisode?: () => void;
}

export function ProjectBanner({
    name,
    description,
    genre,
    targetAudience,
    onCreateCharacter,
    onCreateEpisode,
}: ProjectBannerProps) {
    // Truncate description to 2-3 lines (approximately 150 chars)
    const truncatedDescription =
        description && description.length > 150
            ? `${description.substring(0, 147)}...`
            : description;

    return (
        <div className="relative overflow-hidden rounded-lg border bg-gradient-to-br from-primary/5 via-background to-background">
            {/* Subtle background pattern */}
            <div
                className="absolute inset-0 opacity-[0.015]"
                style={{
                    backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
                    backgroundSize: '40px 40px',
                }}
            />

            <div className="relative px-8 py-10">
                <div className="flex items-start justify-between gap-8">
                    {/* Left: Project Info */}
                    <div className="flex-1 space-y-3">
                        {/* Title with visual emphasis */}
                        <div className="flex items-center gap-3">
                            <div className="bg-primary/10 border-primary/20 flex h-12 w-12 items-center justify-center rounded-lg border">
                                <Sparkles className="text-primary h-6 w-6" />
                            </div>
                            <div>
                                <h1 className="text-3xl font-bold tracking-tight">{name}</h1>
                                {(genre || targetAudience) && (
                                    <div className="mt-1 flex gap-2">
                                        {genre && (
                                            <Badge variant="secondary" className="text-xs">
                                                {genre}
                                            </Badge>
                                        )}
                                        {targetAudience && (
                                            <Badge variant="outline" className="text-xs">
                                                {targetAudience}
                                            </Badge>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Truncated logline */}
                        {truncatedDescription && (
                            <p className="text-muted-foreground max-w-2xl text-base leading-relaxed">
                                {truncatedDescription}
                            </p>
                        )}
                    </div>

                    {/* Right: Primary Actions */}
                    <div className="flex shrink-0 gap-3">
                        {onCreateCharacter && (
                            <Button
                                onClick={onCreateCharacter}
                                size="lg"
                                variant="default"
                                className="gap-2"
                            >
                                <span>Create Character</span>
                                <ArrowRight className="h-4 w-4" />
                            </Button>
                        )}
                        {onCreateEpisode && (
                            <Button
                                onClick={onCreateEpisode}
                                size="lg"
                                variant="outline"
                                className="gap-2"
                            >
                                <span>Create Episode</span>
                                <ArrowRight className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
