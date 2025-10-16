import { notFound } from 'next/navigation';

import {
  canPerformProjectAction,
  getProject,
  getUserProjectRole,
} from '@kit/projects/queries';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { If } from '@kit/ui/if';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import pathsConfig from '~/config/paths.config';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

import { DeleteProjectDialog } from '../../_components/delete-project-dialog';
import { EditProjectDialog } from '../../_components/edit-project-dialog';
import { HomeLayoutPageHeader } from '../../_components/home-page-header';

interface UserProjectPageProps {
  params: Promise<{ id: string }>;
}

export const generateMetadata = async ({ params }: UserProjectPageProps) => {
  const { id } = await params;
  const i18n = await createI18nServerInstance();

  try {
    const project = await getProject(id);

    if (!project) {
      return {
        title: i18n.t('projects:projectDetails'),
      };
    }

    return {
      title: project.name,
    };
  } catch {
    return {
      title: i18n.t('projects:projectDetails'),
    };
  }
};

async function UserProjectPage({ params }: UserProjectPageProps) {
  const { id } = await params;

  let project;
  let userRole;
  let canEdit = false;
  let canDelete = false;

  try {
    [project, userRole] = await Promise.all([
      getProject(id),
      getUserProjectRole(id),
    ]);

    // Check permissions
    [canEdit, canDelete] = await Promise.all([
      canPerformProjectAction(id, 'project.edit'),
      canPerformProjectAction(id, 'project.delete'),
    ]);
  } catch (error) {
    console.error('Failed to load project:', error);
    notFound();
  }

  if (!project) {
    notFound();
  }

  return (
    <>
      <HomeLayoutPageHeader
        title={<Trans i18nKey={'projects:projectDetails'} />}
        description={<AppBreadcrumbs />}
      />

      <PageBody>
        <div className={'flex w-full max-w-4xl flex-col space-y-6 pb-32'}>
          {/* Project Header */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold">{project.name}</h1>
              {project.description && (
                <p className="text-muted-foreground mt-2">
                  {project.description}
                </p>
              )}
              {userRole && (
                <div className="mt-2">
                  <span className="bg-muted text-muted-foreground rounded-md px-2 py-1 text-sm font-medium capitalize">
                    {userRole}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <If condition={canEdit}>
                <EditProjectDialog project={project} />
              </If>

              <If condition={canDelete}>
                <DeleteProjectDialog
                  projectId={project.id}
                  projectName={project.name}
                />
              </If>
            </div>
          </div>

          {/* Project Details Card */}
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans i18nKey={'projects:projectInformation'} />
              </CardTitle>
              <CardDescription>
                <Trans i18nKey={'projects:projectInformationDescription'} />
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-muted-foreground text-sm font-medium">
                    <Trans i18nKey={'projects:statusLabel'} />
                  </dt>
                  <dd className="mt-1 text-sm capitalize">{project.status}</dd>
                </div>
                {project.slug && (
                  <div>
                    <dt className="text-muted-foreground text-sm font-medium">
                      <Trans i18nKey={'projects:slug'} />
                    </dt>
                    <dd className="mt-1 font-mono text-sm">{project.slug}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground text-sm font-medium">
                    <Trans i18nKey={'common:createdAt'} />
                  </dt>
                  <dd className="mt-1 text-sm">
                    {new Date(project.created_at!).toLocaleDateString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-sm font-medium">
                    <Trans i18nKey={'common:updatedAt'} />
                  </dt>
                  <dd className="mt-1 text-sm">
                    {new Date(project.updated_at!).toLocaleDateString()}
                  </dd>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Back to Projects Link */}
          <div>
            <Button variant="link" asChild>
              <a href={pathsConfig.app.personalAccountProjects}>
                ← <Trans i18nKey={'projects:backToProjects'} />
              </a>
            </Button>
          </div>
        </div>
      </PageBody>
    </>
  );
}

export default withI18n(UserProjectPage);
