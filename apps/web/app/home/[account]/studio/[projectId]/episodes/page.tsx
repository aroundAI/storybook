import type { Metadata } from 'next';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, Film } from 'lucide-react';

import type {
  EpisodeMetadata,
  EpisodeStatus,
  ScreenplayData,
  ShotListData,
  StoryData,
} from '@kit/episodes/types';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Card, CardContent } from '@kit/ui/card';
import { PageBody, PageHeader } from '@kit/ui/page';

import { withI18n } from '~/lib/i18n/with-i18n';

import { CreateEpisodeDialog } from './_components/create-episode-dialog';
import { EpisodeCard } from './_components/episode-card';
import { SeasonGeneratorDialog } from './_components/season-generator-dialog';
import { SeasonHeader } from './_components/season-header';

interface EpisodesPageProps {
  params: Promise<{
    account: string;
    projectId: string;
  }>;
}

export async function generateMetadata({
  params,
}: EpisodesPageProps): Promise<Metadata> {
  const { projectId } = await params;
  const client = getSupabaseServerClient();

  const { data: project } = await client
    .from('projects')
    .select('name')
    .eq('id', projectId)
    .single();

  return {
    title: project ? `${project.name} - Episodes` : 'Episodes',
    description: 'Manage episodes for your project',
  };
}

interface Season {
  id: string;
  number: number;
  name: string | null;
  description: string | null;
}

interface Episode {
  id: string;
  project_id: string;
  season_id: string | null;
  number: number;
  title: string;
  description: string | null;
  status: string;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  final_video_url: string | null;
  story_data: unknown;
  screenplay_data: unknown;
  shot_list: unknown;
  metadata: unknown;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

async function EpisodesPage({ params }: EpisodesPageProps) {
  const { account, projectId } = await params;
  const client = getSupabaseServerClient();

  // Fetch project, seasons, and episodes in parallel
  const [projectResult, seasonsResult, episodesResult] = await Promise.all([
    client.from('projects').select('id, name').eq('id', projectId).single(),
    client
      .from('seasons')
      .select('id, number, name, description')
      .eq('project_id', projectId)
      .order('number', { ascending: true }),
    client
      .from('episodes')
      .select('*')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('number', { ascending: true }),
  ]);

  const { data: project, error: projectError } = projectResult;
  const { data: seasons } = seasonsResult;
  const { data: episodes, error: episodesError } = episodesResult;

  if (projectError || !project) {
    notFound();
  }

  if (episodesError) {
    throw new Error('Failed to load episodes');
  }

  // Group episodes by season
  const episodesBySeason = groupEpisodesBySeason(episodes ?? [], seasons ?? []);
  const hasSeasons = (seasons?.length ?? 0) > 0;
  const unassignedEpisodes = episodes?.filter((ep) => !ep.season_id) ?? [];

  return (
    <>
      {/* Back Link */}
      <div className="px-6 pt-6">
        <Link
          href={`/home/${account}/studio/${projectId}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm transition-colors"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Project
        </Link>
      </div>

      <PageHeader
        title="Episodes"
        description="Stories, screenplays, and shot lists for your video content"
      >
        <div className="flex gap-2">
          <SeasonGeneratorDialog projectId={projectId} />
          <CreateEpisodeDialog projectId={projectId} account={account} />
        </div>
      </PageHeader>

      <PageBody>
        {episodes && episodes.length > 0 ? (
          <div className="space-y-10">
            {/* Render episodes grouped by season */}
            {hasSeasons ? (
              <>
                {episodesBySeason.map(({ season, episodes: seasonEpisodes }) => (
                  <div key={season.id}>
                    <div className="mb-6">
                      <SeasonHeader
                        seasonNumber={season.number}
                        seasonName={season.name ?? `Season ${season.number}`}
                        totalEpisodes={seasonEpisodes.length}
                        completedEpisodes={
                          seasonEpisodes.filter(
                            (ep) => ep.status === 'ready' || ep.status === 'published',
                          ).length
                        }
                        inProgressEpisodes={
                          seasonEpisodes.filter((ep) =>
                            ['story', 'storyboard', 'generating', 'editing'].includes(
                              ep.status,
                            ),
                          ).length
                        }
                      />
                    </div>
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                      {seasonEpisodes.map((episode) => (
                        <EpisodeCard
                          key={episode.id}
                          episode={mapEpisode(episode)}
                          account={account}
                          projectId={projectId}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                {/* Unassigned episodes (not in any season) */}
                {unassignedEpisodes.length > 0 && (
                  <div>
                    <div className="mb-6">
                      <h2 className="text-lg font-semibold text-muted-foreground">
                        Standalone Episodes
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Episodes not assigned to any season
                      </p>
                    </div>
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                      {unassignedEpisodes.map((episode) => (
                        <EpisodeCard
                          key={episode.id}
                          episode={mapEpisode(episode)}
                          account={account}
                          projectId={projectId}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* No seasons - flat list of episodes */
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {episodes.map((episode) => (
                  <EpisodeCard
                    key={episode.id}
                    episode={mapEpisode(episode)}
                    account={account}
                    projectId={projectId}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="bg-muted mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                <Film className="text-muted-foreground h-8 w-8" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">No episodes yet</h3>
              <p className="text-muted-foreground mb-6 max-w-sm text-center text-sm">
                Get started by creating your first episode. Each episode can
                have its own story, screenplay, and video content.
              </p>
              <CreateEpisodeDialog projectId={projectId} account={account} />
            </CardContent>
          </Card>
        )}
      </PageBody>
    </>
  );
}

/**
 * Group episodes by their season
 */
function groupEpisodesBySeason(
  episodes: Episode[],
  seasons: Season[],
): Array<{ season: Season; episodes: Episode[] }> {
  return seasons
    .map((season) => ({
      season,
      episodes: episodes
        .filter((ep) => ep.season_id === season.id)
        .sort((a, b) => a.number - b.number),
    }))
    .filter((group) => group.episodes.length > 0);
}

/**
 * Map database episode to component props
 */
function mapEpisode(episode: Episode) {
  return {
    id: episode.id,
    projectId: episode.project_id,
    seasonId: episode.season_id,
    number: episode.number,
    title: episode.title,
    description: episode.description,
    status: episode.status as EpisodeStatus,
    durationSeconds: episode.duration_seconds,
    thumbnailUrl: episode.thumbnail_url,
    finalVideoUrl: episode.final_video_url,
    storyData: episode.story_data as StoryData | null,
    screenplayData: episode.screenplay_data as ScreenplayData | null,
    shotList: episode.shot_list as ShotListData | null,
    metadata: episode.metadata as EpisodeMetadata | null,
    version: episode.version,
    createdAt: episode.created_at,
    updatedAt: episode.updated_at,
    deletedAt: episode.deleted_at,
  };
}

export default withI18n(EpisodesPage);
