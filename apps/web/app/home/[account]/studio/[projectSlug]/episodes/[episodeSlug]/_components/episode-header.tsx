'use client';

import { Calendar } from 'lucide-react';

import type { EpisodeWithShots } from '@kit/episodes/types';

import { StatusBadge } from '../../_components/status-badge';
import { QuickActionsMenu } from './quick-actions-menu';
import { TaggedAssets } from './tagged-assets';

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
  const characterIds = (episode.metadata?.character_ids as string[]) ?? [];
  const locationIds = (episode.metadata?.location_ids as string[]) ?? [];

  return (
    <div className="flex items-start justify-between">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">{episode.title}</h1>
          <StatusBadge status={episode.status} />
        </div>

        {episode.description && (
          <p className="text-muted-foreground max-w-2xl text-sm">
            {episode.description}
          </p>
        )}

        <div className="flex items-center gap-4">
          <p className="text-muted-foreground text-sm">
            Episode {episode.number}
            {episode.season && ` • Season ${episode.season.number}`}
          </p>

          {(characterIds.length > 0 || locationIds.length > 0) && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">Tagged:</span>
              <TaggedAssets
                characterIds={characterIds}
                locationIds={locationIds}
              />
            </div>
          )}
        </div>

        <p className="text-muted-foreground flex items-center gap-1 text-xs">
          <Calendar className="h-3 w-3" />
          Last updated: {new Date(episode.updatedAt).toLocaleString()}
        </p>
      </div>

      <QuickActionsMenu
        episodeId={episode.id}
        episodeTitle={episode.title}
        episodeVersion={episode.version}
        projectId={projectId}
        account={account}
      />
    </div>
  );
}
