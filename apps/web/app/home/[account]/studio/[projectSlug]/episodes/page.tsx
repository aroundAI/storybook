import type { Metadata } from 'next';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, Film } from 'lucide-react';

import type { EpisodeStatus } from '@kit/episodes/types';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { withI18n } from '~/lib/i18n/with-i18n';

import { CollapsibleSeasonSection } from './_components/collapsible-season-section';
import { CreateEpisodeDialog } from './_components/create-episode-dialog';
import { CreateEpisodeWizardWrapper } from './_components/create-episode-wizard-wrapper';
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
  direction_notes: string | null;
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
  metadata: Record<string, unknown> | null;
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
      .select('id, number, name, description, direction_notes')
      .eq('project_id', project.id)
      .order('number', { ascending: true }),
    // Episodes with computed boolean checks instead of fetching full JSON blobs
    client
      .from('episodes')
      .select(
        `
        id, slug, project_id, season_id, number, title, description,
        status, version, duration_seconds, thumbnail_url,
        story_data, screenplay_data, target_duration_seconds,
        metadata,
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
        status, version, duration_seconds, thumbnail_url,
        story_data, screenplay_data, target_duration_seconds,
        metadata,
        created_at, updated_at, deleted_at
      `,
      )
      .eq('project_id', project.id)
      .is('deleted_at', null)
      .is('season_id', null)
      .order('number', { ascending: true }),
  ]);

  const seasons = seasonsResult.data as Season[] | null;
  const episodes = episodesResult.data as Episode[] | null;
  const episodesError = episodesResult.error;
  const unassignedEpisodes = (unassignedResult.data as Episode[] | null) ?? [];

  if (episodesError) {
    throw new Error('Failed to load episodes');
  }

  // Fetch distinct languages per episode via DB-level RPC
  // (SELECT DISTINCT returns ~50 rows vs 1700+ raw dialogue_lines)
  const languageMap = new Map<string, string[]>();
  const episodeIds = (episodes ?? []).map((e) => e.id);

  // Audio stats map: dialogue/music/sfx counts per episode
  const audioStatsMap = new Map<
    string,
    {
      dialogueTotal: number;
      dialogueCompleted: number;
      musicTotal: number;
      musicCompleted: number;
      sfxTotal: number;
      sfxCompleted: number;
    }
  >();

  if (episodeIds.length > 0) {
    // Fetch languages
    const { data: langRows } = await client.rpc(
      'get_episode_languages' as never,
      { p_episode_ids: episodeIds } as never,
    );

    if (langRows) {
      for (const row of langRows as Array<{
        episode_id: string;
        language: string;
      }>) {
        const existing = languageMap.get(row.episode_id);
        if (existing) {
          existing.push(row.language);
        } else {
          languageMap.set(row.episode_id, [row.language]);
        }
      }
    }

    // Fetch audio stats (dialogue/music/sfx counts)
    const { data: statsRows } = await client.rpc(
      'get_episode_audio_stats' as never,
      { p_episode_ids: episodeIds } as never,
    );

    if (statsRows) {
      for (const row of statsRows as Array<{
        episode_id: string;
        dialogue_total: number;
        dialogue_completed: number;
        music_total: number;
        music_completed: number;
        sfx_total: number;
        sfx_completed: number;
      }>) {
        audioStatsMap.set(row.episode_id, {
          dialogueTotal: row.dialogue_total,
          dialogueCompleted: row.dialogue_completed,
          musicTotal: row.music_total,
          musicCompleted: row.music_completed,
          sfxTotal: row.sfx_total,
          sfxCompleted: row.sfx_completed,
        });
      }
    }
  }

  // Batch-query valid asset IDs for library-linked markers
  const allAssetIds = new Set<string>();
  for (const ep of episodes ?? []) {
    const meta = ep.metadata as Record<string, unknown> | null;
    if (meta) {
      for (const id of (meta.character_ids as string[]) ?? [])
        allAssetIds.add(id);
      for (const id of (meta.location_ids as string[]) ?? [])
        allAssetIds.add(id);
    }
  }

  const validAssetIds: string[] = [];
  if (allAssetIds.size > 0) {
    const { data: assetRows } = await client
      .from('assets')
      .select('id')
      .in('id', Array.from(allAssetIds))
      .is('deleted_at', null);
    if (assetRows) {
      for (const row of assetRows) validAssetIds.push(row.id);
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
            <CreateEpisodeWizardWrapper
              projectId={project.id}
              projectSlug={project.slug ?? project.id}
              account={account}
              seasons={(seasons ?? []).map((s) => ({
                id: s.id,
                name: s.name ?? `Season ${s.number}`,
                number: s.number,
              }))}
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
                      projectId={project.id}
                      projectSlug={project.slug ?? project.id}
                      analytics={null}
                      languageMap={languageMap}
                      audioStatsMap={audioStatsMap}
                      validAssetIds={validAssetIds}
                      seasonDescription={season.description}
                      directionNotes={season.direction_notes}
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
                            audioStats={audioStatsMap.get(episode.id)}
                            validAssetIds={validAssetIds}
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
                      audioStats={audioStatsMap.get(episode.id)}
                      validAssetIds={validAssetIds}
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
  const meta = episode.metadata as Record<string, unknown> | null;
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
    finalVideoUrl: null,
    localizedVideos: null,
    storyData: null,
    screenplayData: null,
    shotList: null,
    metadata: null,
    version: 0,
    createdAt: episode.created_at,
    updatedAt: episode.updated_at,
    deletedAt: episode.deleted_at,
    // Asset display data extracted from metadata
    characterNames: (meta?.character_names as string[]) ?? [],
    locationNames: (meta?.location_names as string[]) ?? [],
    characterIds: (meta?.character_ids as string[]) ?? [],
    locationIds: (meta?.location_ids as string[]) ?? [],
  };
}

export default withI18n(EpisodesPage);
