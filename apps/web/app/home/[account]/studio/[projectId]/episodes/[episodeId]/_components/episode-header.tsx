'use client';

import { Calendar } from 'lucide-react';

import type { EpisodeWithShots } from '@kit/episodes/types';

import { StatusBadge } from '../../_components/status-badge';
import { QuickActionsMenu } from './quick-actions-menu';

interface EpisodeHeaderProps {
  episode: EpisodeWithShots;
  projectId: string;
  account: string;
}

export function EpisodeHeader({
  episode,
  projectId,
  account,
}: EpisodeHeaderProps) {
  return (
    <div className="flex items-start justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">{episode.title}</h1>
          <StatusBadge status={episode.status} />
        </div>
        <p className="text-muted-foreground text-sm">
          Episode {episode.number}
          {episode.season && ` • Season ${episode.season.number}`}
        </p>
        <p className="text-muted-foreground flex items-center gap-1 text-xs">
          <Calendar className="h-3 w-3" />
          Last updated: {new Date(episode.updatedAt).toLocaleString()}
        </p>
      </div>

      <QuickActionsMenu
        episodeId={episode.id}
        episodeTitle={episode.title}
        projectId={projectId}
        account={account}
      />
    </div>
  );
}
