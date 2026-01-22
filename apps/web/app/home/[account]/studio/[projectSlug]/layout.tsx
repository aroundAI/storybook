import { notFound } from 'next/navigation';

import { getAccountProjects } from '@kit/projects/queries';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

import { loadTeamWorkspace } from '../../_lib/server/team-account-workspace.loader';
import { MobileStudioHeader } from './_components/mobile-studio-header';
import { StudioModeProvider } from './_components/studio-mode-provider';
import { StudioSidebar } from './_components/studio-sidebar';

interface StudioProjectLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    account: string;
    projectSlug: string;
  }>;
}

export default async function StudioProjectLayout({
  children,
  params,
}: StudioProjectLayoutProps) {
  const { account, projectSlug } = await params;
  const client = getSupabaseServerClient();

  // Parallel fetch: user and workspace (no dependencies)
  const [user, workspace] = await Promise.all([
    requireUserInServerComponent(),
    loadTeamWorkspace(account),
  ]);

  const accountId = workspace.account.id;

  // Parallel fetch: all project data and counts
  // We first need the project ID for counts, so we fetch project first
  const { data: project, error: projectError } = await client
    .from('projects')
    .select('id, name, slug, account_id')
    .eq('slug', projectSlug)
    .eq('account_id', accountId)
    .single();

  if (projectError || !project) {
    notFound();
  }

  // Parallel fetch: projects list and all counts
  const [allProjects, episodesResult, charactersResult, locationsResult] =
    await Promise.all([
      getAccountProjects(accountId),
      client
        .from('episodes')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .is('deleted_at', null),
      client
        .from('assets')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .eq('type', 'character')
        .is('deleted_at', null),
      client
        .from('assets')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .eq('type', 'location')
        .is('deleted_at', null),
    ]);

  const sidebarProps = {
    project,
    account,
    recentProjects: allProjects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      updated_at: p.updated_at ?? undefined,
    })),
    user,
    counts: {
      episodes: episodesResult.count ?? undefined,
      characters: charactersResult.count ?? undefined,
      locations: locationsResult.count ?? undefined,
    },
  };

  return (
    <StudioModeProvider>
      <div className="flex h-screen flex-col">
        {/* Mobile Header - visible only on mobile */}
        <MobileStudioHeader {...sidebarProps} />

        <div className="flex min-h-0 flex-1">
          {/* Desktop Sidebar - hidden on mobile */}
          <div className="hidden md:block">
            <StudioSidebar {...sidebarProps} />
          </div>

          {/* Main Content */}
          <main className="flex-1 overflow-y-auto bg-[#F5F5F7] dark:bg-[#0A0A0A]">{children}</main>
        </div>
      </div>
    </StudioModeProvider>
  );
}
