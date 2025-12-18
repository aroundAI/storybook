'use client';

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
      <div className="space-y-1">
        {/* Title + Status Badge */}
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{episode.title}</h1>
          <StatusBadge status={episode.status} />
        </div>

        {/* Metadata line: Episode/Season + Tagged Assets */}
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            Episode {episode.number}
            {episode.season && ` • Season ${episode.season.number}`}
          </span>

          {(characterIds.length > 0 || locationIds.length > 0) && (
            <>
              <span className="text-border">|</span>
              <TaggedAssets
                characterIds={characterIds}
                locationIds={locationIds}
              />
            </>
          )}
        </div>
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
