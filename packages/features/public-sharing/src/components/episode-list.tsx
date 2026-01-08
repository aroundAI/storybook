import Link from 'next/link';
import { Play, Clock } from 'lucide-react';
import { Card, CardContent } from '@kit/ui/card';

interface Episode {
    id: string;
    title: string;
    description: string | null;
    public_slug: string | null;
    season_number: number | null;
    number: number | null;
    duration_seconds: number | null;
    thumbnail_url: string | null;
}

interface EpisodeListProps {
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

function groupBySeason(episodes: Episode[]): Record<number, Episode[]> {
    const grouped: Record<number, Episode[]> = {};
    for (const ep of episodes) {
        const season = ep.season_number ?? 1;
        if (!grouped[season]) grouped[season] = [];
        grouped[season].push(ep);
    }
    return grouped;
}

export function EpisodeList({
    episodes,
    companySlug,
    projectSlug,
    currentEpisodeId,
}: EpisodeListProps) {
    const seasons = groupBySeason(episodes);
    const seasonNumbers = Object.keys(seasons)
        .map(Number)
        .sort((a, b) => a - b);

    if (episodes.length === 0) {
        return (
            <div className="text-center py-12 text-muted-foreground">
                <p>No episodes available yet.</p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {seasonNumbers.map((seasonNum) => {
                const seasonEpisodes = seasons[seasonNum];
                if (!seasonEpisodes) return null;
                return (
                    <div key={seasonNum}>
                        <h3 className="text-lg font-semibold mb-4">
                            Season {seasonNum}{' '}
                            <span className="text-muted-foreground font-normal">
                                ({seasonEpisodes.length} episodes)
                            </span>
                        </h3>
                        <div className="space-y-3">
                            {seasonEpisodes.map((episode) => {
                                const isCurrent = episode.id === currentEpisodeId;
                                const episodeUrl = `/@${companySlug}/${projectSlug}/e/${episode.public_slug}`;

                                return (
                                    <Link
                                        key={episode.id}
                                        href={episodeUrl}
                                        className="block"
                                    >
                                        <Card
                                            className={`transition-colors hover:bg-accent ${isCurrent ? 'border-primary bg-accent' : ''
                                                }`}
                                        >
                                            <CardContent className="p-4 flex gap-4">
                                                {/* Thumbnail */}
                                                <div className="relative w-32 h-20 bg-muted rounded-md overflow-hidden flex-shrink-0">
                                                    {episode.thumbnail_url ? (
                                                        <img
                                                            src={episode.thumbnail_url}
                                                            alt={episode.title}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center">
                                                            <Play className="w-8 h-8 text-muted-foreground" />
                                                        </div>
                                                    )}
                                                    {episode.duration_seconds && (
                                                        <span className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded">
                                                            {formatDuration(episode.duration_seconds)}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Info */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs text-muted-foreground">
                                                            S{seasonNum}E{episode.number}
                                                        </span>
                                                        {isCurrent && (
                                                            <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">
                                                                Now Playing
                                                            </span>
                                                        )}
                                                    </div>
                                                    <h4 className="font-medium truncate">
                                                        {episode.title}
                                                    </h4>
                                                    {episode.description && (
                                                        <p className="text-sm text-muted-foreground line-clamp-2">
                                                            {episode.description}
                                                        </p>
                                                    )}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
