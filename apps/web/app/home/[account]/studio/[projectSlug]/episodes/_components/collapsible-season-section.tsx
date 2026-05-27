'use client';

import { useState } from 'react';

import type { Episode } from '@kit/episodes/types';

import { EpisodeListItem } from './episode-list-item';
import { SeasonHeader } from './season-header';

interface SeasonAnalyticsSummary {
  totalViews: number;
  avgEngagementRate: number;
}

interface CollapsibleSeasonSectionProps {
  seasonId: string;
  seasonNumber: number;
  seasonName: string;
  episodes: Episode[];
  account: string;
  projectSlug: string;
  analytics: SeasonAnalyticsSummary | null;
  languageMap?: Map<string, string[]>;
  audioStatsMap?: Map<string, {
    dialogueTotal: number;
    dialogueCompleted: number;
    musicTotal: number;
    musicCompleted: number;
    sfxTotal: number;
    sfxCompleted: number;
  }>;
}

export function CollapsibleSeasonSection({
  seasonId,
  seasonNumber,
  seasonName,
  episodes,
  account,
  projectSlug,
  analytics,
  languageMap,
  audioStatsMap,
}: CollapsibleSeasonSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const completedEpisodes = episodes.filter(
    (ep) => ep.status === 'ready' || ep.status === 'published',
  ).length;

  const inProgressEpisodes = episodes.filter((ep) =>
    ['story', 'storyboard', 'generating', 'editing'].includes(ep.status),
  ).length;

  return (
    <div key={seasonId} className="space-y-3">
      <SeasonHeader
        seasonNumber={seasonNumber}
        seasonName={seasonName}
        totalEpisodes={episodes.length}
        completedEpisodes={completedEpisodes}
        inProgressEpisodes={inProgressEpisodes}
        analytics={analytics}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
      />

      {/* Episode list - collapsible */}
      {!isCollapsed && (
        <div className="animate-in fade-in slide-in-from-top-2 space-y-3 duration-200">
          {episodes.map((episode, index) => (
            <EpisodeListItem
              key={episode.id}
              episode={episode}
              account={account}
              projectSlug={projectSlug}
              availableLanguages={languageMap?.get(episode.id)}
              audioStats={audioStatsMap?.get(episode.id)}
              isFirst={index === 0}
              isLast={index === episodes.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
