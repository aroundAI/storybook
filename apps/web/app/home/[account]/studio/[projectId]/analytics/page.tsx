/**
 * Project Analytics Page
 *
 * Displays aggregated analytics for all content in a project.
 */
import { Suspense } from 'react';

import { ProjectDashboard } from '@kit/content-analytics/components';
import { getProjectAnalytics } from '@kit/content-analytics/server';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

interface PageParams {
  params: Promise<{
    account: string;
    projectId: string;
  }>;
}

export default async function ProjectAnalyticsPage({ params }: PageParams) {
  const { projectId, account: _account } = await params;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Track your content performance across all platforms."
      />
      <PageBody>
        <Suspense fallback={<AnalyticsSkeleton />}>
          <ProjectAnalyticsLoader projectId={projectId} />
        </Suspense>
      </PageBody>
    </>
  );
}

async function ProjectAnalyticsLoader({ projectId }: { projectId: string }) {
  const data = await getProjectAnalytics(projectId);

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">
          No analytics data available yet.
        </p>
        <p className="text-muted-foreground mt-2 text-sm">
          Publish content and sync analytics to see performance metrics.
        </p>
      </div>
    );
  }

  return <ProjectDashboard data={data} />;
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
      <Skeleton className="h-48" />
    </div>
  );
}
