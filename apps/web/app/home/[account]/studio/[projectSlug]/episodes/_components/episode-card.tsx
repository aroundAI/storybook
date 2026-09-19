'use client';

import Link from 'next/link';

import { ArrowRight } from 'lucide-react';

import type { Episode } from '@kit/episodes/types';
import { Card, CardContent, CardHeader } from '@kit/ui/card';

import { StageIndicator } from './status-badge';

interface EpisodeCardProps {
  episode: Episode;
  account: string;
  projectSlug: string;
}

function getStageStatus(episode: Episode) {
  return {
    story: episode.storyData?.fullStory ? 'complete' : 'empty',
    screenplay: episode.screenplayData?.scenes
      ? 'complete'
      : episode.storyData?.fullStory
        ? 'in-progress'
        : 'empty',
    shots: episode.shotList?.shots
      ? 'complete'
      : episode.screenplayData?.scenes
        ? 'in-progress'
        : 'empty',
  } as const;
}

export function EpisodeCard({
  episode,
  account,
  projectSlug,
}: EpisodeCardProps) {
  const href = `/home/${account}/studio/${projectSlug}/episodes/${episode.slug ?? episode.id}`;
  const stages = getStageStatus(episode);

  // Calculate overall progress for the visual indicator
  const completedStages = Object.values(stages).filter(
    (s) => s === 'complete',
  ).length;
  const progressPercent = Math.round((completedStages / 3) * 100);

  return (
    <Link href={href}>
      <Card className="group relative overflow-hidden border-l-4 border-primary/70 transition-all duration-300 hover:-translate-y-1 hover:border-primary hover:shadow-xl">
        {/* Gradient background with primary color */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-50 transition-opacity group-hover:opacity-70" />

        <CardHeader className="relative pb-3">
          {/* Episode Number - Dominant, using primary color */}
          <div className="flex items-start justify-between">
            <div className="text-[5rem] leading-none font-light tracking-tighter text-primary/20">
              {String(episode.number).padStart(2, '0')}
            </div>
            <ArrowRight className="mt-2 h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
          </div>

          {/* Title - Emphasized */}
          <h3 className="-mt-4 line-clamp-2 text-xl leading-tight font-semibold text-foreground">
            {episode.title}
          </h3>
        </CardHeader>

        <CardContent className="relative space-y-3 pt-0">
          {/* Progress bar - visual indicator of completion */}
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Status Progress - Status Pills */}
          <div className="flex items-center gap-4 border-t border-border/50 pt-3">
            <StageIndicator stage="Story" status={stages.story} />
            <StageIndicator stage="Screenplay" status={stages.screenplay} />
            <StageIndicator stage="Shots" status={stages.shots} />
          </div>

          {/* Date - Footer */}
          <div className="mono-data text-xs text-muted-foreground">
            Updated {new Date(episode.updatedAt).toLocaleDateString()}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
