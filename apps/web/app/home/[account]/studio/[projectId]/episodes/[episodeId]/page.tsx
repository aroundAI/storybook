import type { Metadata } from 'next';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft } from 'lucide-react';

import type {
  EpisodeMetadata,
  EpisodeStatus,
  EpisodeWithShots,
  ScreenplayData,
  ShotListData,
  StoryData,
} from '@kit/episodes/types';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@kit/ui/breadcrumb';
import { Button } from '@kit/ui/button';

import { withI18n } from '~/lib/i18n/with-i18n';

import { EpisodeHeader } from './_components/episode-header';
import { WorkspaceTabs } from './_components/workspace-tabs';

type WorkspaceTab = 'story' | 'visuals' | 'audio' | 'edit';

interface EpisodeWorkspacePageProps {
  params: Promise<{
    account: string;
    projectId: string;
    episodeId: string;
  }>;
  searchParams: Promise<{
    tab?: string;
  }>;
}

export async function generateMetadata({
  params,
}: EpisodeWorkspacePageProps): Promise<Metadata> {
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

function isValidWorkspaceTab(tab: string | undefined): tab is WorkspaceTab {
  return (
    tab !== undefined && ['story', 'visuals', 'audio', 'edit'].includes(tab)
  );
}

async function EpisodeWorkspacePage({
  params,
  searchParams,
}: EpisodeWorkspacePageProps) {
  const { account, projectId, episodeId } = await params;
  const { tab } = await searchParams;

  const client = getSupabaseServerClient();

  // Fetch episode and project in parallel for optimal performance
  const [episodeResult, projectResult] = await Promise.all([
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
    client.from('projects').select('name').eq('id', projectId).single(),
  ]);

  const { data: episodeData, error: episodeError } = episodeResult;
  const { data: project } = projectResult;

  if (episodeError || !episodeData) {
    notFound();
  }

  // Get season data - Supabase returns relations as objects for single matches
  const seasonData = Array.isArray(episodeData.season)
    ? episodeData.season[0]
    : episodeData.season;

  // Transform database response to typed Episode
  // Note: StoryStudio component fetches its own data via useEpisodeQuery,
  // so we pass an empty shots array here for initial render
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
    // Shots are loaded client-side by StoryStudio via useEpisodeQuery
    shots: [],
    season: seasonData
      ? {
          id: seasonData.id,
          name: seasonData.name ?? '',
          number: seasonData.number,
        }
      : null,
  };

  const defaultTab = isValidWorkspaceTab(tab) ? tab : 'story';

  return (
    <div className="container mx-auto space-y-6 py-6">
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/home/${account}/studio/${projectId}/episodes`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Link>
        </Button>

        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href={`/home/${account}/studio/${projectId}`}>
                {project?.name ?? 'Project'}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink
                href={`/home/${account}/studio/${projectId}/episodes`}
              >
                Episodes
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{episode.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </nav>

      {/* Episode Header */}
      <EpisodeHeader
        episode={episode}
        projectId={projectId}
        account={account}
      />

      {/* Main Workspace Tabs */}
      <WorkspaceTabs episode={episode} defaultTab={defaultTab} />
    </div>
  );
}

export default withI18n(EpisodeWorkspacePage);
