import { notFound } from 'next/navigation';

import type { ContentStyle, Genre, VideoStyle } from '@kit/film-studio-schemas';
import {
  canPerformProjectAction,
  getAvailableProjectMembers,
  getProjectMembers,
  getUserProjectRole,
} from '@kit/projects/queries';
import type { ProjectMemberWithUser } from '@kit/projects/types';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { If } from '@kit/ui/if';
import { Trans } from '@kit/ui/trans';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

import { AddProjectMemberDialog } from '../../../_components/add-project-member-dialog';
import { DeleteProjectDialog } from '../../../_components/delete-project-dialog';
import { EditProjectDialog } from '../../../_components/edit-project-dialog';
import { loadTeamWorkspace } from '../../../_lib/server/team-account-workspace.loader';
import { StudioSettingsForm } from './_components/studio-settings-form';

interface ProjectSettingsPageProps {
  params: Promise<{ account: string; projectSlug: string }>;
}

export const generateMetadata = async ({
  params,
}: ProjectSettingsPageProps) => {
  const { projectSlug } = await params;
  const i18n = await createI18nServerInstance();

  try {
    const client = getSupabaseServerClient();
    const { data: project } = await client
      .from('projects')
      .select('name')
      .eq('slug', projectSlug)
      .single();

    if (!project) {
      return {
        title: i18n.t('projects:projectDetails'),
      };
    }

    return {
      title: `${project.name} - Settings`,
    };
  } catch {
    return {
      title: i18n.t('projects:projectDetails'),
    };
  }
};

async function ProjectSettingsPage({ params }: ProjectSettingsPageProps) {
  const { account, projectSlug } = await params;

  // Load workspace to verify access
  await loadTeamWorkspace(account);

  const client = getSupabaseServerClient();

  // First fetch project by slug
  const { data: project, error: projectError } = await client
    .from('projects')
    .select('*')
    .eq('slug', projectSlug)
    .single();

  if (projectError || !project) {
    notFound();
  }

  let members;
  let userRole;
  let availableMembers;
  let canEdit = false;
  let canDelete = false;
  let canAddMembers = false;

  try {
    [members, userRole, availableMembers] = await Promise.all([
      getProjectMembers(project.id),
      getUserProjectRole(project.id),
      getAvailableProjectMembers(project.id, account),
    ]);

    // Check permissions
    [canEdit, canDelete, canAddMembers] = await Promise.all([
      canPerformProjectAction(project.id, 'project.edit'),
      canPerformProjectAction(project.id, 'project.delete'),
      canPerformProjectAction(project.id, 'project.members.add'),
    ]);
  } catch (error) {
    console.error('Failed to load project:', error);
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="flex flex-col space-y-6">
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
                accountSlug={account}
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

        {/* Studio Content Generation Settings */}
        <If condition={canEdit}>
          <StudioSettingsForm
            projectId={project.id}
            currentSettings={{
              targetAudience: (project.metadata as Record<string, unknown>)
                ?.targetAudience as string | undefined,
              genre: (project.metadata as Record<string, unknown>)?.genre as
                | Genre
                | undefined,
              videoStyle: (project.metadata as Record<string, unknown>)
                ?.videoStyle as VideoStyle | undefined,
              contentStyle: (project.metadata as Record<string, unknown>)
                ?.contentStyle as ContentStyle | undefined,
              defaultEpisodeDuration: (
                project.metadata as Record<string, unknown>
              )?.defaultEpisodeDuration as number | undefined,
              contentRating: (project.metadata as Record<string, unknown>)
                ?.contentRating as
                | 'G'
                | 'PG'
                | 'PG-13'
                | 'R'
                | 'NR'
                | undefined,
              language: (project.metadata as Record<string, unknown>)
                ?.language as string | undefined,
              recurringElement: (project.metadata as Record<string, unknown>)
                ?.recurringElement as
                | {
                  enabled?: boolean;
                  location?: string;
                  purpose?: string;
                  placement?: 'beginning' | 'middle' | 'end' | 'throughout';
                  dialogueHints?: string;
                }
                | undefined,
            }}
          />
        </If>

        {/* Project Members Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  <Trans i18nKey={'projects:projectMembers'} />
                </CardTitle>
                <CardDescription>
                  <Trans i18nKey={'projects:projectMembersDescription'} />
                </CardDescription>
              </div>
              <If condition={canAddMembers}>
                <AddProjectMemberDialog
                  projectId={project.id}
                  availableMembers={
                    availableMembers.map((member) => ({
                      user_id: member.user_id,
                      user_name: member.name,
                      user_email: member.email,
                    })) || []
                  }
                />
              </If>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {members.map((member: ProjectMemberWithUser) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full">
                      {member.user.name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <div className="text-sm font-medium">
                        {member.user.name || member.user.email || 'Unknown'}
                      </div>
                      {member.user.email && (
                        <div className="text-muted-foreground text-xs">
                          {member.user.email}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="bg-muted rounded-md px-2 py-1 text-sm font-medium capitalize">
                    {member.role}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Back to Project Overview Link */}
        <div>
          <Button variant="link" asChild>
            <a href={`/home/${account}/studio/${project.slug}`}>
              ← Back to Project Overview
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export default withI18n(ProjectSettingsPage);
