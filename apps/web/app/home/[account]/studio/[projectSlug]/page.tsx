import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import { getProjectAnalytics } from '@kit/content-analytics/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { withI18n } from '~/lib/i18n/with-i18n';

import { OverviewContent } from './_components/overview-content';

interface StudioProjectPageProps {
  params: Promise<{
    account: string;
    projectSlug: string;
  }>;
}

export async function generateMetadata({
  params,
}: StudioProjectPageProps): Promise<Metadata> {
  const { projectSlug } = await params;
  const client = getSupabaseServerClient();

  const { data: project } = await client
    .from('projects')
    .select('name')
    .eq('slug', projectSlug)
    .single();

  return {
    title: project?.name ?? 'Project Dashboard',
    description: 'Manage your film project',
  };
}

async function StudioProjectPage({ params }: StudioProjectPageProps) {
  const { account, projectSlug } = await params;
  const client = getSupabaseServerClient();

  // First fetch project by slug to get its ID
  const { data: project, error } = await client
    .from('projects')
    .select('id, name, slug, description, metadata, created_at')
    .eq('slug', projectSlug)
    .single();

  if (error || !project) {
    notFound();
  }

  // Fetch counts and episode status data in parallel using project ID
  const [
    { count: characterCount },
    { count: locationCount },
    { count: episodeCount },
    { data: recentEpisodes },
    { data: episodeStatusData },
    analytics,
  ] = await Promise.all([
    client
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', project.id)
      .eq('type', 'character')
      .is('deleted_at', null),
    client
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', project.id)
      .eq('type', 'location')
      .is('deleted_at', null),
    client
      .from('episodes')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', project.id)
      .is('deleted_at', null),
    // Fetch 3 most recent episodes with status data
    client
      .from('episodes')
      .select(
        'id, slug, title, number, updated_at, story_data, screenplay_data, shot_list',
      )
      .eq('project_id', project.id)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(3),
    // Fetch all episodes for production status calculation
    client
      .from('episodes')
      .select('id, story_data, screenplay_data, shot_list')
      .eq('project_id', project.id)
      .is('deleted_at', null),
    // Fetch analytics
    getProjectAnalytics(project.id).catch(() => null),
  ]);

  // Extract metadata
  const metadata = (project.metadata ?? {}) as {
    genre?: string;
    targetAudience?: string;
    format?: string;
    coverImageUrl?: string;
  };

  const baseUrl = `/home/${account}/studio/${project.slug}`;

  // Calculate production status from episode data
  type StoryData = { fullStory?: string };
  type ScreenplayData = { scenes?: unknown[] };
  type ShotListData = { shots?: unknown[] };

  const productionStatus = {
    scriptsComplete:
      episodeStatusData?.filter(
        (e) => (e.story_data as StoryData | null)?.fullStory,
      ).length ?? 0,
    storyboardsComplete:
      episodeStatusData?.filter(
        (e) =>
          ((e.screenplay_data as ScreenplayData | null)?.scenes?.length ?? 0) >
          0,
      ).length ?? 0,
    visualsComplete:
      episodeStatusData?.filter(
        (e) => ((e.shot_list as ShotListData | null)?.shots?.length ?? 0) > 0,
      ).length ?? 0,
    totalEpisodes: episodeCount ?? 0,
  };

  // Map recent episodes to include stage info
  const mappedEpisodes =
    recentEpisodes?.map((ep) => {
      const storyData = ep.story_data as StoryData | null;
      const screenplayData = ep.screenplay_data as ScreenplayData | null;
      const shotListData = ep.shot_list as ShotListData | null;

      let stage: 'draft' | 'story' | 'screenplay' | 'shots' = 'draft';
      if ((shotListData?.shots?.length ?? 0) > 0) stage = 'shots';
      else if ((screenplayData?.scenes?.length ?? 0) > 0) stage = 'screenplay';
      else if (storyData?.fullStory) stage = 'story';

      return {
        id: ep.id,
        title: ep.title,
        number: ep.number,
        updated_at: ep.updated_at,
        stage,
      };
    }) ?? [];

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-7xl p-8">
        <OverviewContent
          project={{
            id: project.id,
            name: project.name,
            description: project.description,
          }}
          metadata={metadata}
          episodeCount={episodeCount ?? 0}
          characterCount={characterCount ?? 0}
          locationCount={locationCount ?? 0}
          recentEpisodes={mappedEpisodes}
          productionStatus={productionStatus}
          analytics={analytics}
          baseUrl={baseUrl}
        />
      </div>
    </div>
  );
}

export default withI18n(StudioProjectPage);
