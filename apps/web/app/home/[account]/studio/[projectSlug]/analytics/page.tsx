/**
 * Project Analytics Page
 *
 * Displays aggregated analytics dashboard with tabs for all content in a project.
 * Includes Overview, Content, Audience, and AI Insights tabs.
 */
import { Suspense } from 'react';

import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import { AnalyticsDashboardSkeleton } from '@kit/content-analytics/components';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { LazyAnalyticsDashboard } from './_components/lazy-analytics-dashboard';

interface PageParams {
  params: Promise<{
    account: string;
    projectSlug: string;
  }>;
}

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { projectSlug } = await params;
  const client = getSupabaseServerClient();

  const { data: project } = await client
    .from('projects')
    .select('name')
    .eq('slug', projectSlug)
    .single();

  return {
    title: project?.name ? `${project.name} Analytics` : 'Analytics',
    description: 'Track your content performance across all platforms.',
  };
}

export default async function ProjectAnalyticsPage({ params }: PageParams) {
  const { projectSlug, account } = await params;
  const client = getSupabaseServerClient();

  // First fetch project by slug to get its ID
  const { data: project } = await client
    .from('projects')
    .select('id')
    .eq('slug', projectSlug)
    .single();

  if (!project) {
    notFound();
  }

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Track your content performance across all platforms."
      />
      <PageBody>
        <Suspense fallback={<AnalyticsDashboardSkeleton />}>
          <LazyAnalyticsDashboard
            projectId={project.id}
            accountSlug={account}
          />
        </Suspense>
      </PageBody>
    </>
  );
}
