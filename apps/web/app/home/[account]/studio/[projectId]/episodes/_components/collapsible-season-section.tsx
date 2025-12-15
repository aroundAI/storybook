'use client';

import { useState } from 'react';

import type { Episode } from '@kit/episodes/types';

import { SeasonHeader } from './season-header';
import { EpisodeListItem } from './episode-list-item';

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
    projectId: string;
    analytics: SeasonAnalyticsSummary | null;
}

export function CollapsibleSeasonSection({
    seasonId,
    seasonNumber,
    seasonName,
    episodes,
    account,
    projectId,
    analytics,
}: CollapsibleSeasonSectionProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);

    const completedEpisodes = episodes.filter(
        (ep) => ep.status === 'ready' || ep.status === 'published',
    ).length;

    const inProgressEpisodes = episodes.filter((ep) =>
        ['story', 'storyboard', 'generating', 'editing'].includes(ep.status),
    ).length;

    return (
        <div key={seasonId}>
            <div className="mb-6">
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
            </div>

            {/* Episode list - collapsible */}
            {!isCollapsed && (
                <div className="p-6 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="space-y-0 relative">
                        {episodes.map((episode, index) => (
                            <EpisodeListItem
                                key={episode.id}
                                episode={episode}
                                account={account}
                                projectId={projectId}
                                isFirst={index === 0}
                                isLast={index === episodes.length - 1}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
