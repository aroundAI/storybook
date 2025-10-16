import { Suspense } from 'react';

import { PlusCircle } from 'lucide-react';

import { CreateProjectForm, ProjectsList } from '@kit/projects/components';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
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

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';

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

  // Get account ID from slug (you'll need to implement this helper)
  // For now, we'll pass the account slug and handle it in the component
  const accountId = account; // This should be converted to UUID

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
              basePath={`/home/${account}/projects`}
            />
          </Suspense>
        </div>
      </PageBody>
    </>
  );
}

export default withI18n(TeamAccountProjectsPage);
