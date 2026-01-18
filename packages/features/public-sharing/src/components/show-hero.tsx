'use client';

import Link from 'next/link';
import { Play, Film, Users, Clock } from 'lucide-react';
import { Button } from '@kit/ui/button';
import { HeroBackground } from './ui/gradient-background';
import { ShareButton } from './share-button';

interface ShowHeroProps {
    title: string;
    logline?: string | null;
    coverImageUrl?: string | null;
    genre?: string | null;
    targetAudience?: string | null;
    episodeCount: number;
    firstEpisodeSlug?: string | null;
    accountSlug: string;
    projectSlug: string;
    shareUrl: string;
}

export function ShowHero({
    title,
    logline,
    coverImageUrl,
    genre,
    targetAudience,
    episodeCount,
    firstEpisodeSlug,
    accountSlug,
    projectSlug,
    shareUrl,
}: ShowHeroProps) {
    const watchUrl = firstEpisodeSlug
        ? `/@${accountSlug}/${projectSlug}/e/${firstEpisodeSlug}`
        : undefined;

    return (
        <HeroBackground imageUrl={coverImageUrl} className="min-h-[60vh] flex items-end pb-12">
            <div className="container mx-auto px-4">
                <div className="max-w-3xl">
                    {/* Show Title */}
                    <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 dark:text-white mb-4 tracking-tight">
                        {title}
                    </h1>

                    {/* Logline */}
                    {logline && (
                        <p className="text-lg md:text-xl text-slate-700 dark:text-slate-300 mb-6 leading-relaxed max-w-2xl">
                            {logline}
                        </p>
                    )}

                    {/* Metadata Pills */}
                    <div className="flex flex-wrap items-center gap-3 mb-8">
                        {genre && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100/80 dark:bg-white/10 text-sm text-slate-700 dark:text-white backdrop-blur-sm border border-slate-200 dark:border-white/10">
                                <Film className="w-3.5 h-3.5" />
                                {genre}
                            </span>
                        )}
                        {targetAudience && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100/80 dark:bg-white/10 text-sm text-slate-700 dark:text-white backdrop-blur-sm border border-slate-200 dark:border-white/10">
                                <Users className="w-3.5 h-3.5" />
                                {targetAudience}
                            </span>
                        )}
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100/80 dark:bg-white/10 text-sm text-slate-700 dark:text-white backdrop-blur-sm border border-slate-200 dark:border-white/10">
                            <Clock className="w-3.5 h-3.5" />
                            {episodeCount} {episodeCount === 1 ? 'Episode' : 'Episodes'}
                        </span>
                    </div>

                    {/* CTAs */}
                    <div className="flex flex-wrap items-center gap-4">
                        {watchUrl && (
                            <Button
                                asChild
                                size="lg"
                                className="bg-white text-black hover:bg-white/90 font-semibold px-8"
                            >
                                <Link href={watchUrl}>
                                    <Play className="w-5 h-5 mr-2 fill-current" />
                                    Watch Episode 1
                                </Link>
                            </Button>
                        )}
                        <ShareButton
                            url={shareUrl}
                            title={title}
                            variant="ghost"
                            className="text-slate-700 hover:bg-slate-100 dark:text-white dark:hover:bg-white/10"
                        />
                    </div>
                </div>
            </div>
        </HeroBackground>
    );
}
