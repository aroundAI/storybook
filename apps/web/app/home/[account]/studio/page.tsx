import { Suspense } from 'react';

import Link from 'next/link';

import { Plus } from 'lucide-react';

import { ProjectsList } from '@kit/projects/components/projects-list';
import { Button } from '@kit/ui/button';
import { Heading } from '@kit/ui/heading';

import { withI18n } from '~/lib/i18n/with-i18n';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';

export const metadata = {
  title: 'Film Studio | Create AI-Generated Videos',
  description:
    'Create and manage your AI-generated video projects with Film Studio',
};

interface PageProps {
  params: Promise<{ account: string }>;
}

async function FilmStudioPage({ params }: PageProps) {
  const { account } = await params;

  // Load the team workspace to get the account UUID
  const workspace = await loadTeamWorkspace(account);
  const accountId = workspace.account.id;

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <Heading level={2}>Film Studio</Heading>
          <p className="text-muted-foreground mt-2">
            Create and manage your AI-generated video projects
          </p>
        </div>

        <Button asChild data-test="create-project-button">
          <Link href={`/home/${account}/studio/projects/new`}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Link>
        </Button>
      </div>

      <Suspense fallback={<div>Loading projects...</div>}>
        <ProjectsList
          accountId={accountId}
          basePath={`/home/${account}/studio`}
        />
      </Suspense>
    </div>
  );
}

export default withI18n(FilmStudioPage);
