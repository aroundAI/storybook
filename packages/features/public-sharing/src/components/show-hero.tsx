'use client';

import Link from 'next/link';

import { Clock, Film, Play, Users } from 'lucide-react';

import { Button } from '@kit/ui/button';

import { ShareButton } from './share-button';
import { HeroBackground } from './ui/gradient-background';

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
    <HeroBackground
      imageUrl={coverImageUrl}
      className="flex min-h-[60vh] items-end pb-12"
    >
      <div className="container mx-auto px-4">
        <div className="max-w-3xl">
          {/* Show Title */}
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-slate-900 md:text-5xl lg:text-6xl dark:text-white">
            {title}
          </h1>

          {/* Logline */}
          {logline && (
            <p className="mb-6 max-w-2xl text-lg leading-relaxed text-slate-700 md:text-xl dark:text-slate-300">
              {logline}
            </p>
          )}

          {/* Metadata Pills */}
          <div className="mb-8 flex flex-wrap items-center gap-3">
            {genre && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100/80 px-3 py-1.5 text-sm text-slate-700 backdrop-blur-sm dark:border-white/10 dark:bg-white/10 dark:text-white">
                <Film className="h-3.5 w-3.5" />
                {genre}
              </span>
            )}
            {targetAudience && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100/80 px-3 py-1.5 text-sm text-slate-700 backdrop-blur-sm dark:border-white/10 dark:bg-white/10 dark:text-white">
                <Users className="h-3.5 w-3.5" />
                {targetAudience}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100/80 px-3 py-1.5 text-sm text-slate-700 backdrop-blur-sm dark:border-white/10 dark:bg-white/10 dark:text-white">
              <Clock className="h-3.5 w-3.5" />
              {episodeCount} {episodeCount === 1 ? 'Episode' : 'Episodes'}
            </span>
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap items-center gap-4">
            {watchUrl && (
              <Button
                asChild
                size="lg"
                className="bg-white px-8 font-semibold text-black hover:bg-white/90"
              >
                <Link href={watchUrl}>
                  <Play className="mr-2 h-5 w-5 fill-current" />
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
