'use client';

import { useContext, useState } from 'react';

import type { Episode } from '@kit/episodes/types';
import { Checkbox } from '@kit/ui/checkbox';
import { cn } from '@kit/ui/utils';

import { EpisodeListItem } from './episode-list-item';
import { SelectionContext } from './episode-list-wrapper';
import { SeasonHeader } from './season-header';

interface SeasonAnalyticsSummary {
  totalViews: number;
  avgEngagementRate: number;
}

interface AudioStats {
  dialogueTotal: number;
  dialogueCompleted: number;
  musicTotal: number;
  musicCompleted: number;
  sfxTotal: number;
  sfxCompleted: number;
}

interface CollapsibleSeasonSectionProps {
  seasonId: string;
  seasonNumber: number;
  seasonName: string;
  episodes: Episode[];
  account: string;
  accountId: string;
  projectId: string;
  projectSlug: string;
  analytics: SeasonAnalyticsSummary | null;
  languageMap?: Map<string, string[]>;
  audioStatsMap?: Map<string, AudioStats>;
  validAssetIds?: string[];
  seasonDescription?: string | null;
  directionNotes?: string | null;
}

export function CollapsibleSeasonSection({
  seasonId,
  seasonNumber,
  seasonName,
  episodes,
  account,
  accountId,
  projectId,
  projectSlug,
  analytics,
  languageMap,
  audioStatsMap,
  validAssetIds,
  seasonDescription,
  directionNotes,
}: CollapsibleSeasonSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const selection = useContext(SelectionContext);

  const completedEpisodes = episodes.filter(
    (ep) => ep.status === 'ready' || ep.status === 'published',
  ).length;

  const inProgressEpisodes = episodes.filter((ep) =>
    ['story', 'storyboard', 'generating', 'editing'].includes(ep.status),
  ).length;

  const episodeIds = episodes.map((ep) => ep.id);
  const selectedInSeason = selection
    ? episodeIds.filter((id) => selection.selectedIds.has(id)).length
    : 0;
  const allSelected =
    selectedInSeason === episodes.length && episodes.length > 0;
  const someSelected = selectedInSeason > 0 && !allSelected;

  function handleSeasonToggle() {
    if (!selection) return;
    if (allSelected) {
      episodeIds.forEach((id) => {
        if (selection.selectedIds.has(id)) {
          selection.onToggleSelect(id);
        }
      });
    } else {
      episodeIds.forEach((id) => {
        if (!selection.selectedIds.has(id)) {
          selection.onToggleSelect(id);
        }
      });
    }
  }

  return (
    <div key={seasonId} className="space-y-3">
      <div className="flex items-start gap-3">
        {selection?.selectionMode && (
          <div className="mt-5 flex-shrink-0">
            <Checkbox
              checked={
                allSelected ? true : someSelected ? 'indeterminate' : false
              }
              onCheckedChange={handleSeasonToggle}
              className={cn(
                'h-5 w-5 rounded border-2 transition-colors',
                allSelected
                  ? 'border-indigo-500 bg-indigo-500 text-white'
                  : someSelected
                    ? 'border-indigo-400 bg-indigo-500/30'
                    : 'border-slate-500',
              )}
            />
          </div>
        )}
        <div className="flex-1">
          <SeasonHeader
            seasonId={seasonId}
            seasonNumber={seasonNumber}
            seasonName={seasonName}
            totalEpisodes={episodes.length}
            completedEpisodes={completedEpisodes}
            inProgressEpisodes={inProgressEpisodes}
            projectId={projectId}
            accountId={accountId}
            episodes={episodes}
            audioStatsMap={audioStatsMap}
            analytics={analytics}
            isCollapsed={isCollapsed}
            onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
            seasonDescription={seasonDescription}
            directionNotes={directionNotes}
          />
        </div>
      </div>

      {/* Episode list - collapsible */}
      {!isCollapsed && (
        <div className="space-y-3 duration-200 animate-in fade-in slide-in-from-top-2">
          {episodes.map((episode, index) => (
            <EpisodeListItem
              key={episode.id}
              episode={episode}
              account={account}
              projectSlug={projectSlug}
              availableLanguages={languageMap?.get(episode.id)}
              audioStats={audioStatsMap?.get(episode.id)}
              validAssetIds={validAssetIds}
              isFirst={index === 0}
              isLast={index === episodes.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
