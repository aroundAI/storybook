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

import { loadTeamWorkspace } from '../../../_lib/server/team-account-workspace.loader';
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
  const { account, projectSlug } = await params;
  const client = getSupabaseServerClient();
  const workspace = await loadTeamWorkspace(account);

  const { data: project } = await client
    .from('projects')
    .select('name')
    .eq('slug', projectSlug)
    .eq('account_id', workspace.account.id)
    .maybeSingle();

  return {
    title: project?.name ? `${project.name} Analytics` : 'Analytics',
    description: 'Track your content performance across all platforms.',
  };
}

export default async function ProjectAnalyticsPage({ params }: PageParams) {
  const { projectSlug, account } = await params;
  const client = getSupabaseServerClient();
  const workspace = await loadTeamWorkspace(account);

  // Slugs are unique per account, not globally, so the lookup is scoped to
  // the account in the URL — as `[projectSlug]/layout.tsx` already does.
  // Unscoped, a user in two teams with the same project slug could be shown
  // the other team's project under this team's URL.
  const { data: project } = await client
    .from('projects')
    .select('id, account_id')
    .eq('slug', projectSlug)
    .eq('account_id', workspace.account.id)
    .maybeSingle();

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
            accountId={project.account_id}
          />
        </Suspense>
      </PageBody>
    </>
  );
}
