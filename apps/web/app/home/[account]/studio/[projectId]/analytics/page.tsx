/**
 * Project Analytics Page
 *
 * Displays aggregated analytics dashboard with tabs for all content in a project.
 * Includes Overview, Content, Audience, and AI Insights tabs.
 */
import { Suspense } from 'react';

import type { Metadata } from 'next';

import {
  AnalyticsDashboard,
  AnalyticsDashboardSkeleton,
} from '@kit/content-analytics/components';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

interface PageParams {
  params: Promise<{
    account: string;
    projectId: string;
  }>;
}

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { projectId } = await params;
  const client = getSupabaseServerClient();

  const { data: project } = await client
    .from('projects')
    .select('name')
    .eq('id', projectId)
    .single();

  return {
    title: project?.name ? `${project.name} Analytics` : 'Analytics',
    description: 'Track your content performance across all platforms.',
  };
}

export default async function ProjectAnalyticsPage({ params }: PageParams) {
  const { projectId, account } = await params;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Track your content performance across all platforms."
      />
      <PageBody>
        <Suspense fallback={<AnalyticsDashboardSkeleton />}>
          <AnalyticsDashboard projectId={projectId} accountSlug={account} />
        </Suspense>
      </PageBody>
    </>
  );
}
