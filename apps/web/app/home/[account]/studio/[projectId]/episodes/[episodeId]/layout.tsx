import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import type {
  EpisodeMetadata,
  EpisodeStatus,
  EpisodeWithShots,
  ScreenplayData,
  ShotListData,
  StoryData,
} from '@kit/episodes/types';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { withI18n } from '~/lib/i18n/with-i18n';

import { EpisodeContextProvider } from './_components/episode-context-provider';
import { EpisodeWorkspaceHeader } from './_components/episode-workspace-header';
import { EpisodeWorkspaceTabs } from './_components/episode-workspace-tabs';

interface EpisodeWorkspaceLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    account: string;
    projectId: string;
    episodeId: string;
  }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ episodeId: string }>;
}): Promise<Metadata> {
  const { episodeId } = await params;
  const client = getSupabaseServerClient();

  const { data: episode } = await client
    .from('episodes')
    .select('title, description')
    .eq('id', episodeId)
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
  const { account, projectId, episodeId } = await params;
  const client = getSupabaseServerClient();

  // Fetch episode, project, and shots in parallel for optimal performance
  const [episodeResult, projectResult, shotsResult] = await Promise.all([
    client
      .from('episodes')
      .select(
        `
        *,
        season:seasons(id, name, number)
      `,
      )
      .eq('id', episodeId)
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .single(),
    client
      .from('projects')
      .select('name, account_id')
      .eq('id', projectId)
      .single(),
    client
      .from('shots')
      .select('*')
      .eq('episode_id', episodeId)
      .is('deleted_at', null)
      .order('sequence_number', { ascending: true }),
  ]);

  const { data: episodeData, error: episodeError } = episodeResult;
  const { data: project } = projectResult;
  const { data: shotsData } = shotsResult;

  if (episodeError || !episodeData) {
    notFound();
  }

  // Get season data - Supabase returns relations as objects for single matches
  const seasonData = Array.isArray(episodeData.season)
    ? episodeData.season[0]
    : episodeData.season;

  // Transform database response to typed Episode
  const episode: EpisodeWithShots = {
    id: episodeData.id,
    projectId: episodeData.project_id,
    seasonId: episodeData.season_id,
    number: episodeData.number,
    title: episodeData.title,
    description: episodeData.description,
    status: episodeData.status as EpisodeStatus,
    durationSeconds: episodeData.duration_seconds,
    thumbnailUrl: episodeData.thumbnail_url,
    finalVideoUrl: episodeData.final_video_url,
    storyData: episodeData.story_data as StoryData | null,
    screenplayData: episodeData.screenplay_data as ScreenplayData | null,
    shotList: episodeData.shot_list as ShotListData | null,
    metadata: episodeData.metadata as EpisodeMetadata | null,
    version: episodeData.version,
    createdAt: episodeData.created_at,
    updatedAt: episodeData.updated_at,
    deletedAt: episodeData.deleted_at,
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
  };

  return (
    <EpisodeContextProvider
      episode={episode}
      projectId={projectId}
      accountSlug={account}
      accountId={project?.account_id ?? ''}
      projectName={project?.name ?? 'Project'}
    >
      <div className="flex h-full flex-col bg-[#F5F5F7] dark:bg-gray-900">
        <EpisodeWorkspaceHeader />
        <EpisodeWorkspaceTabs />
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </EpisodeContextProvider>
  );
}

export default withI18n(EpisodeWorkspaceLayout);
