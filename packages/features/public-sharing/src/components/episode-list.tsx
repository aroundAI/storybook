import Link from 'next/link';

import { Play } from 'lucide-react';

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
      <div className="py-12 text-center text-muted-foreground">
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
            <h3 className="mb-4 text-lg font-semibold">
              Season {seasonNum}{' '}
              <span className="font-normal text-muted-foreground">
                ({seasonEpisodes.length} episodes)
              </span>
            </h3>
            <div className="space-y-3">
              {seasonEpisodes.map((episode) => {
                const isCurrent = episode.id === currentEpisodeId;
                const episodeUrl = `/@${companySlug}/${projectSlug}/e/${episode.public_slug}`;

                return (
                  <Link key={episode.id} href={episodeUrl} className="block">
                    <Card
                      className={`transition-colors hover:bg-accent ${
                        isCurrent ? 'border-primary bg-accent' : ''
                      }`}
                    >
                      <CardContent className="flex gap-4 p-4">
                        {/* Thumbnail */}
                        <div className="relative h-20 w-32 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                          {episode.thumbnail_url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={episode.thumbnail_url}
                              alt={episode.title}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <Play className="h-8 w-8 text-muted-foreground" />
                            </div>
                          )}
                          {episode.duration_seconds && (
                            <span className="absolute right-1 bottom-1 rounded bg-black/80 px-1.5 py-0.5 text-xs text-white">
                              {formatDuration(episode.duration_seconds)}
                            </span>
                          )}
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              S{seasonNum}E{episode.number}
                            </span>
                            {isCurrent && (
                              <span className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                                Now Playing
                              </span>
                            )}
                          </div>
                          <h4 className="truncate font-medium">
                            {episode.title}
                          </h4>
                          {episode.description && (
                            <p className="line-clamp-2 text-sm text-muted-foreground">
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
