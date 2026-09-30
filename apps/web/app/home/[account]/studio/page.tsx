import { Suspense } from 'react';

import { StudioProjectsGrid } from '@kit/projects/components';
import { getAccountProjects } from '@kit/projects/queries';
import { Skeleton } from '@kit/ui/skeleton';

import { withI18n } from '~/lib/i18n/with-i18n';

import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';

export const metadata = {
  title: 'Film Studio Projects | Create AI-Generated Videos',
  description:
    'Create and manage your AI-generated video projects with Film Studio',
};

interface PageProps {
  params: Promise<{ account: string }>;
}

// Data fetching wrapper component
async function StudioProjectsLoader({
  accountId,
  basePath,
}: {
  accountId: string;
  basePath: string;
}) {
  const projects = await getAccountProjects(accountId);

  return <StudioProjectsGrid projects={projects} basePath={basePath} />;
}

async function FilmStudioPage({ params }: PageProps) {
  const { account } = await params;

  // Load the team workspace to get the account UUID
  const workspace = await loadTeamWorkspace(account);
  const accountId = workspace.account.id;
  const basePath = `/home/${account}/studio`;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <Suspense fallback={<StudioSkeleton />}>
        <StudioProjectsLoader accountId={accountId} basePath={basePath} />
      </Suspense>
    </div>
  );
}

// Loading skeleton for the studio page
function StudioSkeleton() {
  return (
    <div className="space-y-8">
      {/* Header skeleton */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <Skeleton className="mb-2 h-10 w-64" />
          <Skeleton className="h-5 w-96" />
        </div>
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>

      {/* Grid skeleton */}
      <div>
        <Skeleton className="mb-6 h-8 w-24" />
        <div className="columns-1 gap-6 sm:columns-2 lg:columns-3 xl:columns-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="mb-6 break-inside-avoid">
              <Skeleton className="aspect-[4/3] rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default withI18n(FilmStudioPage);
