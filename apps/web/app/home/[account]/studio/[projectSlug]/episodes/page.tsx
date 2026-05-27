import type { Metadata } from 'next';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, Film } from 'lucide-react';

import type { EpisodeStatus } from '@kit/episodes/types';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { withI18n } from '~/lib/i18n/with-i18n';

import { CollapsibleSeasonSection } from './_components/collapsible-season-section';
import { CreateEpisodeDialog } from './_components/create-episode-dialog';
import { EpisodeListItem } from './_components/episode-list-item';
import { EpisodesZeroState } from './_components/episodes-zero-state';
import { SeasonGeneratorDialog } from './_components/season-generator-dialog';

interface EpisodesPageProps {
  params: Promise<{
    account: string;
    projectSlug: string;
  }>;
}

export async function generateMetadata({
  params,
}: EpisodesPageProps): Promise<Metadata> {
  const { projectSlug } = await params;
  const client = getSupabaseServerClient();

  const { data: project } = await client
    .from('projects')
    .select('name')
    .eq('slug', projectSlug)
    .single();

  return {
    title: project ? `${project.name} - Episodes` : 'Episodes',
    description: 'Manage episodes for your project',
  };
}

// ISR: Revalidate every 60 seconds
export const revalidate = 60;

interface Season {
  id: string;
  number: number;
  name: string | null;
  description: string | null;
}

interface Episode {
  id: string;
  slug: string | null;
  project_id: string;
  season_id: string | null;
  number: number;
  title: string;
  description: string | null;
  status: string;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  story_data: Record<string, unknown> | null;
  screenplay_data: Record<string, unknown> | null;
  shot_list: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

async function EpisodesPage({ params }: EpisodesPageProps) {
  const { account, projectSlug } = await params;
  const client = getSupabaseServerClient();

  // First fetch project by slug
  const { data: project, error: projectError } = await client
    .from('projects')
    .select('id, name, slug')
    .eq('slug', projectSlug)
    .single();

  if (projectError || !project) {
    notFound();
  }

  // Fetch seasons and episodes using project ID
  const [seasonsResult, episodesResult, unassignedResult] = await Promise.all([
    client
      .from('seasons')
      .select('id, number, name, description')
      .eq('project_id', project.id)
      .order('number', { ascending: true }),
    // Episodes with computed boolean checks instead of fetching full JSON blobs
    client
      .from('episodes')
      .select(
        `
        id, slug, project_id, season_id, number, title, description,
        status, duration_seconds, thumbnail_url,
        created_at, updated_at, deleted_at
      `,
      )
      .eq('project_id', project.id)
      .is('deleted_at', null)
      .order('number', { ascending: true }),
    // Separate query for unassigned episodes (SQL filter instead of JS filter)
    client
      .from('episodes')
      .select(
        `
        id, slug, project_id, season_id, number, title, description,
        status, duration_seconds, thumbnail_url,
        created_at, updated_at, deleted_at
      `,
      )
      .eq('project_id', project.id)
      .is('deleted_at', null)
      .is('season_id', null)
      .order('number', { ascending: true }),
  ]);

  const { data: seasons } = seasonsResult;
  const episodes = episodesResult.data as Episode[] | null;
  const episodesError = episodesResult.error;
  const unassignedEpisodes = (unassignedResult.data as Episode[] | null) ?? [];

  if (episodesError) {
    throw new Error('Failed to load episodes');
  }

  // Fetch available languages per episode (single query for all episodes)
  const languageMap = new Map<string, string[]>();
  const episodeIds = (episodes ?? []).map((e) => e.id);

  if (episodeIds.length > 0) {
    const { data: langRows } = await client
      .from('dialogue_lines')
      .select('episode_id, language')
      .in('episode_id', episodeIds)
      .limit(500);

    if (langRows) {
      for (const row of langRows as Array<{
        episode_id: string;
        language: string;
      }>) {
        const existing = languageMap.get(row.episode_id);
        if (existing) {
          if (!existing.includes(row.language)) {
            existing.push(row.language);
          }
        } else {
          languageMap.set(row.episode_id, [row.language]);
        }
      }
    }
  }

  // Group episodes by season
  const episodesBySeason = groupEpisodesBySeason(episodes ?? [], seasons ?? []);
  const hasSeasons = (seasons?.length ?? 0) > 0;

  return (
    <>
      {/* Compact Header */}
      <header className="cinema-workspace border-b border-white/5 px-6 py-5">
        <div className="mb-2">
          <Link
            href={`/home/${account}/studio/${project.slug}`}
            className="inline-flex items-center text-sm text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Project
          </Link>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Film className="h-5 w-5 text-gray-400 dark:text-gray-500" />
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              Episodes
            </h1>
          </div>
          <div className="flex gap-2">
            <SeasonGeneratorDialog projectId={project.id} />
            <CreateEpisodeDialog
              projectId={project.id}
              projectSlug={project.slug ?? project.id}
              account={account}
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {episodes && episodes.length > 0 ? (
          <div className="space-y-6 p-6">
            {/* Render episodes grouped by season */}
            {hasSeasons ? (
              <>
                {episodesBySeason.map(
                  ({ season, episodes: seasonEpisodes }) => (
                    <CollapsibleSeasonSection
                      key={season.id}
                      seasonId={season.id}
                      seasonNumber={season.number}
                      seasonName={season.name ?? `Season ${season.number}`}
                      episodes={seasonEpisodes.map(mapEpisode)}
                      account={account}
                      projectSlug={project.slug ?? project.id}
                      analytics={null}
                      languageMap={languageMap}
                    />
                  ),
                )}

                {/* Unassigned episodes (not in any season) */}
                {unassignedEpisodes.length > 0 && (
                  <div>
                    <div className="mb-6">
                      <h2 className="text-muted-foreground text-lg font-semibold">
                        Standalone Episodes
                      </h2>
                      <p className="text-muted-foreground text-sm">
                        Episodes not assigned to any season
                      </p>
                    </div>
                    <div className="cinema-panel p-6">
                      <div className="relative space-y-0">
                        {unassignedEpisodes.map((episode, index) => (
                          <EpisodeListItem
                            key={episode.id}
                            episode={mapEpisode(episode)}
                            account={account}
                            projectSlug={project.slug ?? project.id}
                            availableLanguages={languageMap.get(episode.id)}
                            isFirst={index === 0}
                            isLast={index === unassignedEpisodes.length - 1}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* No seasons - flat list of episodes */
              <div className="cinema-panel p-6">
                <div className="relative space-y-0">
                  {episodes.map((episode, index) => (
                    <EpisodeListItem
                      key={episode.id}
                      episode={mapEpisode(episode)}
                      account={account}
                      projectSlug={project.slug ?? project.id}
                      availableLanguages={languageMap.get(episode.id)}
                      isFirst={index === 0}
                      isLast={index === episodes.length - 1}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <EpisodesZeroState
            projectId={project.id}
            projectSlug={project.slug ?? project.id}
            account={account}
          />
        )}
      </div>
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
 * Note: JSON blob fields are not loaded in list query - component derives status from episode.status
 */
function mapEpisode(episode: Episode) {
  return {
    id: episode.id,
    slug: episode.slug,
    projectId: episode.project_id,
    seasonId: episode.season_id,
    number: episode.number,
    title: episode.title,
    description: episode.description,
    status: episode.status as EpisodeStatus,
    durationSeconds: episode.duration_seconds,
    thumbnailUrl: episode.thumbnail_url,
    finalVideoUrl: null, // Not loaded in list query
    localizedVideos: null, // Not loaded in list query
    storyData: null, // Not loaded in list query - use status field
    screenplayData: null, // Not loaded in list query - use status field
    shotList: null, // Not loaded in list query - use status field
    metadata: null, // Not loaded in list query
    version: 0, // Not loaded in list query
    createdAt: episode.created_at,
    updatedAt: episode.updated_at,
    deletedAt: episode.deleted_at,
  };
}

export default withI18n(EpisodesPage);
