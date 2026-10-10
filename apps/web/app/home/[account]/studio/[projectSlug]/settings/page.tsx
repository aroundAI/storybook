import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, ArrowRight, Settings } from 'lucide-react';

import type { CanonSettings } from '@kit/episodes';
import { resolveProjectType } from '@kit/episodes/lib';
import type { ContentStyle, Genre, VideoStyle } from '@kit/film-studio-schemas';
import {
  getAvailableProjectMembers,
  getProjectMembers,
  getProjectPermissions,
} from '@kit/projects/queries';
import type { ProjectMemberWithUser } from '@kit/projects/types';
import { ProjectChannelPicker } from '@kit/publishing/components';
import {
  getAccountPlatformConnections,
  getProjectChannelSelection,
} from '@kit/publishing/server/queries';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Badge } from '@kit/ui/badge';
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
import { AudioSettingsForm } from './_components/audio-settings-form';
import { CanonSettingsForm } from './_components/canon-settings-form';
import { ProjectCoverSettings } from './_components/project-cover-settings';
import { ProjectIntroSettings } from './_components/project-intro-settings';
import { StudioSettingsForm } from './_components/studio-settings-form';
import { ProjectVisibilitySettings } from './_components/visibility-settings';

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
    .select(
      `
      id, name, slug, description, account_id, metadata, status, visibility,
      audio_settings, created_by, updated_by, public_slug, seo_metadata,
      sequel_of, created_at, updated_at
    `,
    )
    .eq('slug', projectSlug)
    .single();

  if (projectError || !project) {
    notFound();
  }

  let members;
  let availableMembers;
  let permissions = {
    canView: false,
    canEdit: false,
    canDelete: false,
    canAddMembers: false,
    role: null as string | null,
  };

  try {
    // Fetch all data in parallel - single permission call instead of 3
    [members, availableMembers, permissions] = await Promise.all([
      getProjectMembers(project.id),
      getAvailableProjectMembers(project.id, account),
      getProjectPermissions(project.id),
    ]);
  } catch (error) {
    console.error('Failed to load project:', error);
    notFound();
  }

  // Fetch publishing configs and account public profile
  const [projectChannelIds, platformConnections, accountData] =
    await Promise.all([
      getProjectChannelSelection(project.id),
      getAccountPlatformConnections(project.account_id ?? ''),
      client
        .from('accounts')
        .select('public_profile')
        .eq('id', project.account_id ?? '')
        .single(),
    ]);

  const isAccountPublic =
    (accountData.data?.public_profile as Record<string, unknown>)?.is_public ===
    true;

  return (
    <>
      {/* Fixed Header */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="mb-2">
          <Link
            href={`/home/${account}/studio/${project.slug}`}
            className="inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Project
          </Link>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-bold text-foreground">
              Project Settings
            </h1>
            {permissions.role && (
              <Badge variant="secondary" className="capitalize">
                {permissions.role}
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            <If condition={permissions.canEdit}>
              <EditProjectDialog project={project} />
            </If>

            <If condition={permissions.canDelete}>
              <DeleteProjectDialog
                projectId={project.id}
                projectName={project.name}
                accountSlug={account}
              />
            </If>
          </div>
        </div>
      </header>

      {/* Scrollable Content */}
      <div className="flex-1">
        <div className="mx-auto max-w-4xl space-y-8 p-6">
          {/* ─── Section: Overview (read-only, no save) ─── */}
          <section className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Overview</h2>
              <p className="text-sm text-muted-foreground">
                Basic project information and branding.
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>
                  <Trans i18nKey={'projects:projectInformation'} />
                </CardTitle>
                <CardDescription>
                  <Trans i18nKey={'projects:projectInformationDescription'} />
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">
                      <Trans i18nKey={'projects:statusLabel'} />
                    </dt>
                    <dd className="mt-0.5 text-sm capitalize">
                      {project.status}
                    </dd>
                  </div>
                  {project.slug && (
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">
                        <Trans i18nKey={'projects:slug'} />
                      </dt>
                      <dd className="mt-0.5 font-mono text-sm">
                        {project.slug}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">
                      <Trans i18nKey={'common:createdAt'} />
                    </dt>
                    <dd className="mt-0.5 text-sm">
                      {new Date(project.created_at!).toLocaleDateString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">
                      <Trans i18nKey={'common:updatedAt'} />
                    </dt>
                    <dd className="mt-0.5 text-sm">
                      {new Date(project.updated_at!).toLocaleDateString()}
                    </dd>
                  </div>
                </div>
              </CardContent>
            </Card>

            <If condition={permissions.canEdit}>
              <ProjectCoverSettings
                projectId={project.id}
                currentCoverUrl={
                  (project.metadata as Record<string, unknown>)
                    ?.coverImageUrl as string | undefined
                }
              />
            </If>
          </section>

          {/* ─── Section: Content Generation (1 form, 1 save) ─── */}
          <If condition={permissions.canEdit}>
            <section className="border-t pt-8">
              <div className="mb-6">
                <h2 className="text-lg font-semibold">Content Generation</h2>
                <p className="text-sm text-muted-foreground">
                  AI story generation, visual style, and recurring story
                  elements.
                </p>
              </div>

              <StudioSettingsForm
                projectId={project.id}
                currentSettings={{
                  description: project.description ?? undefined,
                  targetAudience: (project.metadata as Record<string, unknown>)
                    ?.targetAudience as string | undefined,
                  genre: (project.metadata as Record<string, unknown>)
                    ?.genre as Genre | undefined,
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
                  projectAestheticStyle: (
                    project.metadata as Record<string, unknown>
                  )?.projectAestheticStyle as string | undefined,
                  recurringElements: (() => {
                    const meta = project.metadata as Record<string, unknown>;
                    if (Array.isArray(meta?.recurringElements)) {
                      return meta.recurringElements as Array<{
                        id?: string;
                        name?: string;
                        enabled?: boolean;
                        location?: string;
                        purpose?: string;
                        placement?:
                          | 'beginning'
                          | 'middle'
                          | 'end'
                          | 'throughout';
                        dialogueHints?: string;
                      }>;
                    }
                    const old = meta?.recurringElement as
                      | {
                          enabled?: boolean;
                          location?: string;
                          purpose?: string;
                          placement?:
                            | 'beginning'
                            | 'middle'
                            | 'end'
                            | 'throughout';
                          dialogueHints?: string;
                        }
                      | undefined;
                    if (old) {
                      return [
                        {
                          id: crypto.randomUUID(),
                          name: 'Recurring Element',
                          ...old,
                        },
                      ];
                    }
                    return undefined;
                  })(),
                }}
              />
            </section>
          </If>

          {/* ─── Section: Audio (1 form, 1 save) ─── */}
          <If condition={permissions.canEdit}>
            <section className="border-t pt-8">
              <div className="mb-6">
                <h2 className="text-lg font-semibold">Audio Generation</h2>
                <p className="text-sm text-muted-foreground">
                  Voice, sound effects, and music generation settings.
                </p>
              </div>

              <AudioSettingsForm
                projectId={project.id}
                accountId={project.account_id ?? ''}
                currentSettings={
                  (project as Record<string, unknown>).audio_settings as {
                    elevenlabs?: {
                      enabled?: boolean;
                      tts_model?: string;
                      sfx_model?: string;
                    };
                    voice_provider?:
                      | 'elevenlabs'
                      | 'playht'
                      | 'azure'
                      | 'google';
                  } | null
                }
              />
            </section>
          </If>

          {/* ─── Section: Canon (1 form, 1 save) ─── */}
          <If condition={permissions.canEdit}>
            <section className="border-t pt-8">
              <div className="mb-6">
                <h2 className="text-lg font-semibold">Story Continuity</h2>
                <p className="text-sm text-muted-foreground">
                  Canon management and episode-to-episode consistency.
                </p>
              </div>

              <CanonSettingsForm
                projectId={project.id}
                projectType={resolveProjectType(project.metadata).projectType}
                currentSettings={
                  (project.metadata as { canon?: CanonSettings } | null)
                    ?.canon ?? null
                }
              />

              {/* Fact Library link */}
              <Link
                href={`/home/${account}/studio/${project.slug}/settings/facts`}
                className="mt-4 flex items-center justify-between rounded-lg border border-border bg-card px-5 py-4 transition-colors hover:bg-accent"
              >
                <div>
                  <p className="text-sm font-medium">Fact Library</p>
                  <p className="text-xs text-muted-foreground">
                    Manage verified facts and sources for documentary content.
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </section>
          </If>

          {/* ─── Section: StorybookStudio (FILM-2004 sub-pages) ─── */}
          <section className="border-t pt-8">
            <div className="mb-6">
              <h2 className="text-lg font-semibold">StorybookStudio</h2>
              <p className="text-sm text-muted-foreground">
                What the desktop AI editor applies when it cuts an episode.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  path: 'brand',
                  title: 'Brand',
                  text: 'Fonts, colours, caption style, logo, intro and outro.',
                },
                {
                  path: 'edit-policy',
                  title: 'Edit policy',
                  text: 'Shot lengths, transitions, music ducking, captions.',
                },
              ].map((link) => (
                <Link
                  key={link.path}
                  data-test={`settings-link-${link.path}`}
                  href={`/home/${account}/studio/${project.slug}/settings/${link.path}`}
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-5 py-4 transition-colors hover:bg-accent"
                >
                  <div>
                    <p className="text-sm font-medium">{link.title}</p>
                    <p className="text-xs text-muted-foreground">{link.text}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </section>

          {/* ─── Section: Visibility (1 form, 1 save) ─── */}
          <If condition={permissions.canEdit}>
            <section className="border-t pt-8">
              <div className="mb-6">
                <h2 className="text-lg font-semibold">Visibility & Sharing</h2>
                <p className="text-sm text-muted-foreground">
                  Control who can access this project.
                </p>
              </div>

              <ProjectVisibilitySettings
                projectId={project.id}
                projectName={project.name}
                accountSlug={account}
                currentVisibility={project.visibility ?? 'private'}
                currentPublicSlug={project.public_slug ?? null}
                isAccountPublic={isAccountPublic}
              />
            </section>
          </If>

          {/* ─── Section: Publishing & Branding (no unified form) ─── */}
          <If condition={permissions.canEdit}>
            <section className="space-y-6 border-t pt-8">
              <div>
                <h2 className="text-lg font-semibold">Publishing & Branding</h2>
                <p className="text-sm text-muted-foreground">
                  Intro videos and publishing destinations.
                </p>
              </div>

              <ProjectIntroSettings projectId={project.id} />

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    This project&apos;s channels
                  </CardTitle>
                  <CardDescription>
                    Episodes in this project publish only to these channels.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ProjectChannelPicker
                    projectId={project.id}
                    channels={platformConnections}
                    selectedIds={projectChannelIds}
                    channelSettingsUrl={`/home/${account}/settings/platforms`}
                  />
                </CardContent>
              </Card>
            </section>
          </If>

          {/* ─── Section: Team (no form) ─── */}
          <section className="space-y-6 border-t pt-8">
            <div>
              <h2 className="text-lg font-semibold">Team</h2>
              <p className="text-sm text-muted-foreground">
                Project members and collaboration.
              </p>
            </div>

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
                  <If condition={permissions.canAddMembers}>
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
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                          {member.user.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <div className="text-sm font-medium">
                            {member.user.name || member.user.email || 'Unknown'}
                          </div>
                          {member.user.email && (
                            <div className="text-xs text-muted-foreground">
                              {member.user.email}
                            </div>
                          )}
                        </div>
                      </div>
                      <Badge variant="secondary" className="capitalize">
                        {member.role}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </>
  );
}

export default withI18n(ProjectSettingsPage);
