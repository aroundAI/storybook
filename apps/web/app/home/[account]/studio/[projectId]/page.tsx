import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody } from '@kit/ui/page';

import { getProjectAnalytics } from '@kit/content-analytics/server';

import { withI18n } from '~/lib/i18n/with-i18n';

import { AnalyticsPreview } from './_components/analytics-preview';
import { ProjectBanner } from './_components/project-banner';
import { QuickActions } from './_components/quick-actions';
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

  // Fetch project and counts in parallel
  const [
    { data: project, error },
    { count: characterCount },
    { count: locationCount },
    { count: episodeCount },
    { data: recentEpisodes },
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
    // Fetch 3 most recent episodes
    client
      .from('episodes')
      .select('id, title, number, updated_at')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(3),
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
  };

  const baseUrl = `/home/${account}/studio/${projectId}`;

  // Prepare analytics data for preview
  const platformBreakdown = analytics?.platformTotals?.map((p) => ({
    platform: p.platform,
    views: p.views,
    percentage: p.percentage,
  })) ?? [];

  return (
    <>
      {/* Project Banner */}
      <div className="px-8 pt-8">
        <ProjectBanner
          name={project.name}
          description={project.description ?? ''}
          genre={metadata.genre}
          targetAudience={metadata.targetAudience}
        />
      </div>

      <PageBody>
        <div className="space-y-6">
          {/* Quick Stats Row */}
          <QuickStats
            episodeCount={episodeCount ?? 0}
            characterCount={characterCount ?? 0}
            locationCount={locationCount ?? 0}
          />

          {/* Quick Actions Toolbar */}
          <QuickActions baseUrl={baseUrl} />

          {/* Two Column Layout: Analytics + Recent Episodes */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Analytics Preview - 1/3 width */}
            <AnalyticsPreview
              totalViews={analytics?.totalViews ?? 0}
              engagementRate={analytics?.avgEngagementRate ?? 0}
              platformBreakdown={platformBreakdown}
              baseUrl={baseUrl}
            />

            {/* Recent Episodes - 2/3 width */}
            <div className="lg:col-span-2">
              <RecentEpisodes
                episodes={recentEpisodes ?? []}
                baseUrl={baseUrl}
              />
            </div>
          </div>
        </div>
      </PageBody>
    </>
  );
}

export default withI18n(StudioProjectPage);
