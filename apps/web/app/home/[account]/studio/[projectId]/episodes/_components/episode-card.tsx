'use client';

import Link from 'next/link';

import { ArrowRight, Check, Circle, MoreHorizontal } from 'lucide-react';

import type { Episode } from '@kit/episodes/types';
import { Card, CardContent, CardHeader } from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

interface EpisodeCardProps {
  episode: Episode;
  account: string;
  projectId: string;
}

function getStageStatus(episode: Episode) {
  return {
    story: episode.storyData?.fullStory ? 'complete' : 'empty',
    screenplay: episode.screenplayData?.scenes ? 'complete' : episode.storyData?.fullStory ? 'in-progress' : 'empty',
    shots: episode.shotList?.shots ? 'complete' : episode.screenplayData?.scenes ? 'in-progress' : 'empty',
  };
}

function StatusIndicator({ status }: { status: 'complete' | 'in-progress' | 'empty' }) {
  if (status === 'complete') {
    return <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />;
  }
  if (status === 'in-progress') {
    return <MoreHorizontal className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />;
  }
  return <Circle className="h-3.5 w-3.5 text-muted-foreground/30" />;
}

export function EpisodeCard({ episode, account, projectId }: EpisodeCardProps) {
  const href = `/home/${account}/studio/${projectId}/episodes/${episode.id}`;
  const stages = getStageStatus(episode);

  return (
    <Link href={href}>
      <Card className="group relative overflow-hidden border-l-4 border-indigo-500 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent opacity-50 transition-opacity group-hover:opacity-70" />

        <CardHeader className="relative pb-3">
          {/* Episode Number - Dominant */}
          <div className="flex items-start justify-between">
            <div className="text-indigo-500/20 dark:text-indigo-400/20 font-light text-[5rem] leading-none tracking-tighter">
              {String(episode.number).padStart(2, '0')}
            </div>
            <ArrowRight className="text-muted-foreground mt-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
          </div>

          {/* Title - Emphasized */}
          <h3 className="text-foreground -mt-4 line-clamp-2 text-xl font-semibold leading-tight">
            {episode.title}
          </h3>
        </CardHeader>

        <CardContent className="relative space-y-3 pt-0">
          {/* Status Progress - Visual Dots */}
          <div className="flex items-center gap-3 border-t border-border/50 pt-3">
            <div className="flex items-center gap-1.5">
              <StatusIndicator status={stages.story} />
              <span className="text-muted-foreground text-xs">Story</span>
            </div>
            <div className="flex items-center gap-1.5">
              <StatusIndicator status={stages.screenplay} />
              <span className="text-muted-foreground text-xs">Screenplay</span>
            </div>
            <div className="flex items-center gap-1.5">
              <StatusIndicator status={stages.shots} />
              <span className="text-muted-foreground text-xs">Shots</span>
            </div>
          </div>

          {/* Date - Footer */}
          <div className="text-muted-foreground text-xs">
            Updated {new Date(episode.updatedAt).toLocaleDateString()}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
