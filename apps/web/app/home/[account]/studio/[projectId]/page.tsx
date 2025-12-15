import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody } from '@kit/ui/page';

import { getProjectAnalytics } from '@kit/content-analytics/server';

import { withI18n } from '~/lib/i18n/with-i18n';

import { AnalyticsPreview } from './_components/analytics-preview';
import { ProductionStatus } from './_components/production-status';
import { ProjectBanner } from './_components/project-banner';
import { QuickStats } from './_components/quick-stats';
import { RecentEpisodes } from './_components/recent-episodes';

interface StudioProjectPageProps {
  params: Promise<{
    account: string;
    projectId: string;
  }>;
}

export async function generateMetadata({
  params,
}: StudioProjectPageProps): Promise<Metadata> {
  const { projectId } = await params;
  const client = getSupabaseServerClient();

  const { data: project } = await client
    .from('projects')
    .select('name')
    .eq('id', projectId)
    .single();

  return {
    title: project?.name ?? 'Project Dashboard',
    description: 'Manage your film project',
  };
}

async function StudioProjectPage({ params }: StudioProjectPageProps) {
  const { account, projectId } = await params;
  const client = getSupabaseServerClient();

  // Fetch project, counts, and episode status data in parallel
  const [
    { data: project, error },
    { count: characterCount },
    { count: locationCount },
    { count: episodeCount },
    { data: recentEpisodes },
    { data: episodeStatusData },
    analytics,
  ] = await Promise.all([
    client
      .from('projects')
      .select('id, name, description, metadata, created_at')
      .eq('id', projectId)
      .single(),
    client
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('type', 'character')
      .is('deleted_at', null),
    client
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('type', 'location')
      .is('deleted_at', null),
    client
      .from('episodes')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('deleted_at', null),
    // Fetch 3 most recent episodes with status data
    client
      .from('episodes')
      .select('id, title, number, updated_at, story_data, screenplay_data, shot_list')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(3),
    // Fetch all episodes for production status calculation
    client
      .from('episodes')
      .select('id, story_data, screenplay_data, shot_list')
      .eq('project_id', projectId)
      .is('deleted_at', null),
    // Fetch analytics
    getProjectAnalytics(projectId).catch(() => null),
  ]);

  if (error || !project) {
    notFound();
  }

  // Extract metadata
  const metadata = (project.metadata ?? {}) as {
    genre?: string;
    targetAudience?: string;
    format?: string;
    coverImageUrl?: string;
  };

  const baseUrl = `/home/${account}/studio/${projectId}`;

  // Calculate production status from episode data
  // Type assertions needed because these are Json fields from the database
  type StoryData = { fullStory?: string };
  type ScreenplayData = { scenes?: unknown[] };
  type ShotListData = { shots?: unknown[] };

  const productionStatus = {
    scriptsComplete: episodeStatusData?.filter(e => (e.story_data as StoryData | null)?.fullStory).length ?? 0,
    storyboardsComplete: episodeStatusData?.filter(e => ((e.screenplay_data as ScreenplayData | null)?.scenes?.length ?? 0) > 0).length ?? 0,
    visualsComplete: episodeStatusData?.filter(e => ((e.shot_list as ShotListData | null)?.shots?.length ?? 0) > 0).length ?? 0,
    totalEpisodes: episodeCount ?? 0,
  };

  // Prepare analytics data for preview
  const platformBreakdown = analytics?.platformTotals?.map((p) => ({
    platform: p.platform,
    views: p.views,
    percentage: p.percentage,
  })) ?? [];

  const hasAnalyticsData = (analytics?.totalViews ?? 0) > 0;

  // Map recent episodes to include stage info
  const mappedEpisodes = recentEpisodes?.map(ep => {
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
    <div className="min-h-screen bg-[#F4F4F5] dark:bg-[#09090B]">
      {/* Project Banner - Cinematic Hero with Backdrop */}
      <div className="px-8 pt-6">
        <ProjectBanner
          name={project.name}
          description={project.description ?? ''}
          genre={metadata.genre}
          targetAudience={metadata.targetAudience}
          format={metadata.format}
          posterUrl={metadata.coverImageUrl}
          backgroundUrl={metadata.coverImageUrl}
        />
      </div>

      <PageBody>
        {/* Control Strip (Stats + Actions) */}
        <QuickStats
          episodeCount={episodeCount ?? 0}
          characterCount={characterCount ?? 0}
          locationCount={locationCount ?? 0}
          baseUrl={baseUrl}
        />

        {/* 12-Column Grid: Activity (1-8) + Health (9-12) */}
        <div className="grid grid-cols-12 gap-6">
          {/* Recent Activity - Cols 1-8 */}
          <div className="col-span-12 lg:col-span-8">
            <RecentEpisodes
              episodes={mappedEpisodes}
              baseUrl={baseUrl}
            />
          </div>

          {/* Production Health - Cols 9-12 */}
          <div className="col-span-12 lg:col-span-4">
            {hasAnalyticsData ? (
              <AnalyticsPreview
                totalViews={analytics?.totalViews ?? 0}
                engagementRate={analytics?.avgEngagementRate ?? 0}
                platformBreakdown={platformBreakdown}
                baseUrl={baseUrl}
              />
            ) : (
              <ProductionStatus
                scriptsComplete={productionStatus.scriptsComplete}
                storyboardsComplete={productionStatus.storyboardsComplete}
                visualsComplete={productionStatus.visualsComplete}
                totalEpisodes={productionStatus.totalEpisodes}
                baseUrl={baseUrl}
              />
            )}
          </div>
        </div>
      </PageBody>
    </div>
  );
}

export default withI18n(StudioProjectPage);
