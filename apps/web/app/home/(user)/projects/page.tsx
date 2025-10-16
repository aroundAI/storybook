import { Suspense } from 'react';

import { PlusCircle } from 'lucide-react';

import { CreateProjectForm, ProjectsList } from '@kit/projects/components';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@kit/ui/dialog';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import pathsConfig from '~/config/paths.config';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

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

            <Dialog>
              <DialogTrigger asChild>
                <Button size={'sm'} data-test={'create-project-trigger'}>
                  <PlusCircle className={'mr-2 w-4'} />
                  <span>
                    <Trans i18nKey={'projects:createProject'} />
                  </span>
                </Button>
              </DialogTrigger>

              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    <Trans i18nKey={'projects:createProject'} />
                  </DialogTitle>
                  <DialogDescription>
                    <Trans i18nKey={'projects:createProjectDescription'} />
                  </DialogDescription>
                </DialogHeader>

                <CreateProjectForm accountId={accountId} />
              </DialogContent>
            </Dialog>
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
