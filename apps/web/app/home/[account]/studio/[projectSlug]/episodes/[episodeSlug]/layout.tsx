import { cache } from 'react';

import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import { AssetRow, mapRowToAsset } from '@kit/assets';
import { STUDIO_SHOT_COLUMNS, shotFromRow } from '@kit/episodes/lib/shot-row';
import { listOpenExternalRuns } from '@kit/episodes/lib/stage-runs';
import type {
  EpisodeMetadata,
  EpisodeStatus,
  EpisodeWithShots,
  ScreenplayData,
  ShortsGroup,
  ShotListData,
  StoryData,
} from '@kit/episodes/types';
import { canTakeDown, projectRoleOf } from '@kit/publishing/lib/takedown';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { withI18n } from '~/lib/i18n/with-i18n';

import { EpisodeContextProvider } from './_components/episode-context-provider';
import { EpisodeWorkspaceHeader } from './_components/episode-workspace-header';
import { EpisodeWorkspaceTabs } from './_components/episode-workspace-tabs';
import { StageRunBar } from './_components/stage-run-bar';

const getProjectBySlug = cache(async (slug: string) => {
  const client = getSupabaseServerClient();

  return client
    .from('projects')
    .select('id, name, slug, account_id, metadata')
    .eq('slug', slug)
    .single();
});

// Local interface extending the Supabase query result with joined relations
interface EpisodeDataWithRelations {
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
  final_video_url: string | null;
  localized_videos: Record<string, string> | null;
  shorts_groups: ShortsGroup[] | null;
  story_data: StoryData | null;
  screenplay_data: ScreenplayData | null;
  shot_list: ShotListData | null;
  metadata: EpisodeMetadata | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  master_video_asset_id: string | null;
  master_video: AssetRow | null;
  title_cards: AssetRow[] | null;
  // Supabase returns season as single object when using .single() or as array from joins
  // We normalize to single object in the transform below
  season: { id: string; name: string | null; number: number } | null;
}

interface EpisodeWorkspaceLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    account: string;
    projectSlug: string;
    episodeSlug: string;
  }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectSlug: string; episodeSlug: string }>;
}): Promise<Metadata> {
  const { projectSlug, episodeSlug } = await params;
  const client = getSupabaseServerClient();

  // Use cached project query (shared with layout body)
  const { data: project } = await getProjectBySlug(projectSlug);

  if (!project) {
    return { title: 'Episode Not Found' };
  }

  // Then get episode by slug within that project
  const { data: episode } = await client
    .from('episodes')
    .select('title, description')
    .eq('slug', episodeSlug)
    .eq('project_id', project.id)
    .is('deleted_at', null)
    .single();

  if (!episode) {
    return {
      title: 'Episode Not Found',
    };
  }

  return {
    title: `${episode.title} - Episode Workspace`,
    description: episode.description ?? 'Edit and manage your episode',
  };
}

async function EpisodeWorkspaceLayout({
  children,
  params,
}: EpisodeWorkspaceLayoutProps) {
  const { account, projectSlug, episodeSlug } = await params;
  const client = getSupabaseServerClient();

  // Use cached project query (shared with generateMetadata)
  const { data: project, error: projectError } =
    await getProjectBySlug(projectSlug);

  if (projectError || !project) {
    notFound();
  }

  // Fetch episode using the project ID
  const { data: episodeData, error: episodeError } = await client
    .from('episodes')
    .select(
      `
        id, slug, project_id, season_id, number, title, description,
        status, duration_seconds, thumbnail_url, final_video_url,
        localized_videos, shorts_groups, story_data, screenplay_data, shot_list,
        metadata, version, created_at, updated_at, deleted_at,
        master_video_asset_id, generation_origin,
        season:seasons(id, name, number),
        master_video:assets!episodes_master_video_asset_id_fkey(*),
        title_cards:assets!assets_episode_id_fkey(*)
      `,
    )
    .eq('slug', episodeSlug)
    .eq('project_id', project.id)
    .is('deleted_at', null)
    .single();

  if (episodeError || !episodeData) {
    notFound();
  }

  // Now fetch shots using the episode ID
  const { data: shotsData } = await client
    .from('shots')
    .select(STUDIO_SHOT_COLUMNS)
    .eq('episode_id', episodeData.id)
    .is('deleted_at', null)
    .order('sequence_number', { ascending: true });

  // Get season data - Supabase returns relations as objects for single matches
  const seasonData = Array.isArray(episodeData.season)
    ? episodeData.season[0]
    : episodeData.season;

  // Transform database response to typed Episode
  const episode: EpisodeWithShots = {
    id: episodeData.id,
    slug: episodeData.slug,
    projectId: episodeData.project_id,
    seasonId: episodeData.season_id,
    number: episodeData.number,
    title: episodeData.title,
    description: episodeData.description,
    status: episodeData.status as EpisodeStatus,
    durationSeconds: episodeData.duration_seconds,
    thumbnailUrl: episodeData.thumbnail_url,
    finalVideoUrl: episodeData.final_video_url,
    localizedVideos:
      (episodeData as { localized_videos?: Record<string, string> | null })
        .localized_videos ?? null,
    shortsGroups:
      (episodeData as { shorts_groups?: ShortsGroup[] | null }).shorts_groups ??
      null,
    storyData: episodeData.story_data as StoryData | null,
    screenplayData: episodeData.screenplay_data as ScreenplayData | null,
    shotList: episodeData.shot_list as ShotListData | null,
    metadata: episodeData.metadata as EpisodeMetadata | null,
    generationOrigin: episodeData.generation_origin,
    version: episodeData.version,
    createdAt: episodeData.created_at,
    updatedAt: episodeData.updated_at,
    deletedAt: episodeData.deleted_at,
    masterVideoAssetId: (episodeData as EpisodeDataWithRelations)
      .master_video_asset_id,
    masterVideoAsset: (episodeData as EpisodeDataWithRelations).master_video
      ? mapRowToAsset((episodeData as EpisodeDataWithRelations).master_video!)
      : null,
    titleCards: ((episodeData as EpisodeDataWithRelations).title_cards ?? [])
      .filter((asset: AssetRow) => asset.type === 'master_title_card')
      .map(mapRowToAsset),
    shots: shotsData?.map(shotFromRow) ?? [],
    season: seasonData
      ? {
          id: seasonData.id,
          name: seasonData.name ?? '',
          number: seasonData.number,
        }
      : null,
    // Include project metadata for shot prompts (projectAestheticStyle, videoStyle, etc.)
    projectMetadata: (project.metadata as Record<string, unknown>) ?? {},
  };

  // Who may take a published video down: the same list the unpublish
  // actions and the publish worker check (KB-47)
  const { data: user } = await requireUser(client);
  const takedownRole = user
    ? await projectRoleOf(client, project.id, user.id)
    : null;

  // Open external runs for the lease banner (FILM-1910); the page keeps
  // them live over Realtime, so a failed read here only delays the banner
  const externalRuns = await listOpenExternalRuns(client, episode.id).catch(
    () => [],
  );

  return (
    <EpisodeContextProvider
      episode={episode}
      projectId={project.id}
      projectSlug={project.slug ?? project.id}
      accountSlug={account}
      accountId={project.account_id ?? ''}
      projectName={project.name ?? 'Project'}
      projectMetadata={project.metadata as Record<string, unknown> | null}
      canTakeDown={canTakeDown(takedownRole)}
      initialExternalRuns={externalRuns}
    >
      <div className="flex h-full flex-col bg-[#F5F5F7] dark:bg-[#0A0A0A]">
        <EpisodeWorkspaceHeader />
        <EpisodeWorkspaceTabs />
        <StageRunBar />
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </EpisodeContextProvider>
  );
}

export default withI18n(EpisodeWorkspaceLayout);
