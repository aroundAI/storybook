/**
 * Project Analytics Page
 *
 * Displays aggregated analytics dashboard with tabs for all content in a project.
 * Includes Overview, Content, Audience, and AI Insights tabs.
 */
import { Suspense } from 'react';

import {
  AnalyticsDashboard,
  AnalyticsDashboardSkeleton,
} from '@kit/content-analytics/components';
import { PageBody, PageHeader } from '@kit/ui/page';

interface PageParams {
  params: Promise<{
    account: string;
    projectId: string;
  }>;
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
