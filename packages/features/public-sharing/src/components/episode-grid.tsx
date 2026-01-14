'use client';

import Link from 'next/link';
import { Play } from 'lucide-react';
import { cn } from '@kit/ui/utils';
import { GlassCard } from './ui/glass-card';

interface Episode {
    id: string;
    title: string;
    description: string | null;
    slug: string | null;
    season_number: number | null;
    number: number | null;
    duration_seconds: number | null;
    thumbnail_url: string | null;
}

interface EpisodeGridProps {
    episodes: Episode[];
    companySlug: string;
    projectSlug: string;
    currentEpisodeId?: string;
}

function formatDuration(seconds: number | null): string {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function EpisodeGrid({
    episodes,
    companySlug,
    projectSlug,
    currentEpisodeId,
}: EpisodeGridProps) {
    if (episodes.length === 0) {
        return (
            <div className="text-center py-16 text-slate-600 dark:text-slate-400">
                <p className="text-lg">No episodes available yet.</p>
                <p className="text-sm mt-2">Check back soon for new content!</p>
            </div>
        );
    }

    // Group episodes by season for optional season headers
    const groupedBySeason = episodes.reduce((acc, ep) => {
        const season = ep.season_number ?? 1;
        if (!acc[season]) acc[season] = [];
        acc[season].push(ep);
        return acc;
    }, {} as Record<number, Episode[]>);

    const seasons = Object.keys(groupedBySeason).map(Number).sort((a, b) => a - b);
    const showSeasonHeaders = seasons.length > 1 || (seasons[0] && seasons[0] > 1);

    return (
        <div className="space-y-12">
            {seasons.map((seasonNum) => {
                const seasonEpisodes = groupedBySeason[seasonNum] || [];
                return (
                    <div key={seasonNum}>
                        {showSeasonHeaders && (
                            <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-6">
                                Season {seasonNum}
                                <span className="text-slate-600 dark:text-slate-400 font-normal ml-2 text-base">
                                    ({seasonEpisodes.length} episodes)
                                </span>
                            </h3>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {seasonEpisodes.map((episode, idx) => (
                                <EpisodeCard
                                    key={episode.id}
                                    episode={episode}
                                    companySlug={companySlug}
                                    projectSlug={projectSlug}
                                    isCurrent={episode.id === currentEpisodeId}
                                    glowIndex={idx}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

interface EpisodeCardProps {
    episode: Episode;
    companySlug: string;
    projectSlug: string;
    isCurrent?: boolean;
    glowIndex: number;
}

const glowColors = ['indigo', 'violet', 'teal', 'slate'] as const;

function EpisodeCard({
    episode,
    companySlug,
    projectSlug,
    isCurrent,
    glowIndex,
}: EpisodeCardProps) {
    const episodeUrl = `/@${companySlug}/${projectSlug}/e/${episode.slug}`;
    const glowColor = glowColors[glowIndex % glowColors.length];

    return (
        <Link href={episodeUrl} className="block group">
            <GlassCard
                glowColor={glowColor}
                glowPosition={glowIndex % 2 === 0 ? 'top-right' : 'bottom-left'}
                className={cn(
                    isCurrent && 'ring-2 ring-indigo-500'
                )}
            >
                {/* Thumbnail */}
                <div className="relative aspect-video bg-slate-200 dark:bg-slate-800 overflow-hidden rounded-t-2xl">
                    {episode.thumbnail_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                            src={episode.thumbnail_url}
                            alt={episode.title}
                            className="w-full h-full object-cover transition-transform group-hover:scale-105"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800">
                            <Play className="w-12 h-12 text-slate-400 dark:text-slate-500" />
                        </div>
                    )}

                    {/* Episode number badge */}
                    <div className="absolute top-2 left-2 px-2 py-1 rounded bg-black/70 text-xs font-medium text-white backdrop-blur-sm">
                        {episode.season_number ? `S${episode.season_number}` : ''}E{episode.number}
                    </div>

                    {/* Duration badge */}
                    {episode.duration_seconds && (
                        <div className="absolute bottom-2 right-2 px-2 py-1 rounded bg-black/70 text-xs font-medium text-white backdrop-blur-sm">
                            {formatDuration(episode.duration_seconds)}
                        </div>
                    )}

                    {/* Play overlay on hover */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
                        <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transform scale-75 group-hover:scale-100 transition-all shadow-xl">
                            <Play className="w-6 h-6 text-black ml-1 fill-current" />
                        </div>
                    </div>

                    {/* Now Playing indicator */}
                    {isCurrent && (
                        <div className="absolute top-2 right-2 px-2 py-1 rounded bg-indigo-500 text-xs font-medium text-white">
                            Now Playing
                        </div>
                    )}
                </div>

                {/* Episode Info */}
                <div className="p-4">
                    <h4 className="font-semibold text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {episode.title}
                    </h4>
                    {episode.description && (
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
                            {episode.description}
                        </p>
                    )}
                </div>
            </GlassCard>
        </Link>
    );
}
