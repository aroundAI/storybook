'use client';

import { Calendar } from 'lucide-react';

import type { EpisodeWithShots } from '@kit/episodes/types';

import { StatusBadge } from '../../_components/status-badge';
import { QuickActionsMenu } from './quick-actions-menu';
import { TaggedAssets } from './tagged-assets';

interface EpisodeHeaderProps {
  episode: EpisodeWithShots;
  projectSlug: string;
  account: string;
}

export function EpisodeHeader({
  episode,
  projectSlug,
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
          <p className="max-w-2xl text-sm text-muted-foreground">
            {episode.description}
          </p>
        )}

        <div className="flex items-center gap-4">
          <p className="text-sm text-muted-foreground">
            Episode {episode.number}
            {episode.season && ` • Season ${episode.season.number}`}
          </p>

          {(characterIds.length > 0 || locationIds.length > 0) && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Tagged:</span>
              <TaggedAssets
                characterIds={characterIds}
                locationIds={locationIds}
              />
            </div>
          )}
        </div>

        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          Last updated: {new Date(episode.updatedAt).toLocaleString()}
        </p>
      </div>

      <QuickActionsMenu
        episodeId={episode.id}
        episodeTitle={episode.title}
        episodeVersion={episode.version}
        episodeStatus={episode.status}
        projectSlug={projectSlug}
        account={account}
      />
    </div>
  );
}
