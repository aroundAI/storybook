import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import type {
  EpisodeMetadata,
  EpisodeStatus,
  EpisodeWithShots,
  ScreenplayData,
  ShortsGroup,
  ShotListData,
  StoryData,
} from '@kit/episodes/types';
import { AssetRow, mapRowToAsset } from '@kit/assets';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { withI18n } from '~/lib/i18n/with-i18n';

import { EpisodeContextProvider } from './_components/episode-context-provider';
import { EpisodeWorkspaceHeader } from './_components/episode-workspace-header';
import { EpisodeWorkspaceTabs } from './_components/episode-workspace-tabs';

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

  // First get project by slug
  const { data: project } = await client
    .from('projects')
    .select('id')
    .eq('slug', projectSlug)
    .single();

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

  // First fetch the project by slug to get its ID
  const { data: project, error: projectError } = await client
    .from('projects')
    .select('id, name, slug, account_id, metadata')
    .eq('slug', projectSlug)
    .single();

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
        master_video_asset_id,
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
    .select(
      `
      id, episode_id, scene_number, shot_number, sequence_number,
      duration_seconds, scene_description, action_description,
      prompt, camera_direction, status, video_url, thumbnail_url,
      first_frame_url, last_frame_url, generation_job_id, generation_metadata,
      created_at, updated_at, deleted_at
    `,
    )
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
    version: episodeData.version,
    createdAt: episodeData.created_at,
    updatedAt: episodeData.updated_at,
    deletedAt: episodeData.deleted_at,
    masterVideoAssetId: (
      episodeData as unknown as { master_video_asset_id: string | null }
    ).master_video_asset_id,
    masterVideoAsset: (episodeData as unknown as { master_video: AssetRow | null })
      .master_video
      ? mapRowToAsset(
        (episodeData as unknown as { master_video: AssetRow }).master_video,
      )
      : null,
    titleCards: (
      (episodeData as unknown as { title_cards: AssetRow[] | null }).title_cards ??
      []
    )
      .filter((asset: AssetRow) => asset.type === 'master_title_card')
      .map(mapRowToAsset),
    shots:
      shotsData?.map((shot) => ({
        id: shot.id,
        episodeId: shot.episode_id,
        sceneNumber: shot.scene_number ?? 1,
        shotNumber: shot.shot_number ?? shot.sequence_number,
        sequenceNumber: shot.sequence_number,
        description: shot.action_description ?? shot.scene_description ?? '',
        duration: shot.duration_seconds,
        durationSeconds: shot.duration_seconds,
        prompt: shot.prompt,
        cameraAngle: null,
        cameraMovement: null,
        cameraDirection: shot.camera_direction,
        status: shot.status as
          | 'pending'
          | 'generating'
          | 'completed'
          | 'failed',
        videoUrl: shot.video_url,
        thumbnailUrl: shot.thumbnail_url,
        firstFrameUrl:
          (shot as { first_frame_url?: string | null }).first_frame_url ?? null,
        lastFrameUrl:
          (shot as { last_frame_url?: string | null }).last_frame_url ?? null,
        generationJobId: shot.generation_job_id,
        metadata: (shot.generation_metadata as Record<string, unknown>) ?? null,
        generationSettings: null,
        generationStartedAt: null,
        generationCompletedAt: null,
        createdAt: shot.created_at,
        updatedAt: shot.updated_at,
        deletedAt: shot.deleted_at,
      })) ?? [],
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

  return (
    <EpisodeContextProvider
      episode={episode}
      projectId={project.id}
      projectSlug={project.slug ?? project.id}
      accountSlug={account}
      accountId={project.account_id ?? ''}
      projectName={project.name ?? 'Project'}
      projectMetadata={project.metadata as Record<string, unknown> | null}
    >
      <div className="flex h-full flex-col bg-[#F5F5F7] dark:bg-[#0A0A0A]">
        <EpisodeWorkspaceHeader />
        <EpisodeWorkspaceTabs />
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </EpisodeContextProvider>
  );
}

export default withI18n(EpisodeWorkspaceLayout);
