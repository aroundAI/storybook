import { Suspense } from 'react';

import { ProjectsList } from '@kit/projects/components/projects-list';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import pathsConfig from '~/config/paths.config';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

import { CreateProjectDialog } from '../_components/create-project-dialog';
import { HomeLayoutPageHeader } from '../_components/home-page-header';
import { loadUserWorkspace } from '../_lib/server/load-user-workspace';

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();
  const title = i18n.t('projects:pageTitle');

  return {
    title,
  };
};

async function UserProjectsPage() {
  const workspace = await loadUserWorkspace();
  const accountId = workspace.workspace.id!;

  return (
    <>
      <HomeLayoutPageHeader
        title={<Trans i18nKey={'common:routes.projects'} />}
        description={<Trans i18nKey={'common:homeTabDescription'} />}
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
              basePath={pathsConfig.app.personalAccountProjects}
            />
          </Suspense>
        </div>
      </PageBody>
    </>
  );
}

export default withI18n(UserProjectsPage);
