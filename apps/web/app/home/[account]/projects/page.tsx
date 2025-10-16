import { Suspense } from 'react';

import { ProjectsList } from '@kit/projects/components/projects-list';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

import { CreateProjectDialog } from '../_components/create-project-dialog';
import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';

interface TeamAccountProjectsPageProps {
  params: Promise<{ account: string }>;
}

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();
  const title = i18n.t('projects:pageTitle');

  return {
    title,
  };
};

async function TeamAccountProjectsPage({
  params,
}: TeamAccountProjectsPageProps) {
  const { account } = await params;

  // Load the team workspace to get the account UUID
  const workspace = await loadTeamWorkspace(account);
  const accountId = workspace.account.id;

  return (
    <>
      <TeamAccountLayoutPageHeader
        title={<Trans i18nKey={'common:routes.projects'} />}
        description={<AppBreadcrumbs />}
        account={account}
      />

      <PageBody>
        <div className={'flex w-full flex-col space-y-6 pb-32'}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">
                <Trans i18nKey={'projects:pageTitle'} />
              </h1>
              <p className="text-muted-foreground">
                <Trans i18nKey={'projects:pageDescription'} />
              </p>
            </div>

            <CreateProjectDialog accountId={accountId} />
          </div>

          <Suspense fallback={<div>Loading projects...</div>}>
            <ProjectsList
              accountId={accountId}
              basePath={`/home/${account}/projects`}
            />
          </Suspense>
        </div>
      </PageBody>
    </>
  );
}

export default withI18n(TeamAccountProjectsPage);
