import { notFound } from 'next/navigation';

import { getAccountProjects } from '@kit/projects/queries';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

import { loadTeamWorkspace } from '../../_lib/server/team-account-workspace.loader';
import { MobileStudioHeader } from './_components/mobile-studio-header';
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

  // Get user data for the unified footer
  const user = await requireUserInServerComponent();

  // Load the team workspace to get the account UUID
  const workspace = await loadTeamWorkspace(account);
  const accountId = workspace.account.id;

  // Fetch all projects for this account using the shared query
  const allProjects = await getAccountProjects(accountId);

  // First fetch the project by slug to get its ID
  const { data: project, error: projectError } = await client
    .from('projects')
    .select('id, name, slug, account_id')
    .eq('slug', projectSlug)
    .eq('account_id', accountId)
    .single();

  if (projectError || !project) {
    notFound();
  }

  // Now fetch counts using the project ID
  const [
    { count: episodesCount },
    { count: charactersCount },
    { count: locationsCount },
  ] = await Promise.all([
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
      episodes: episodesCount ?? undefined,
      characters: charactersCount ?? undefined,
      locations: locationsCount ?? undefined,
    },
  };

  return (
    <div className="flex h-screen flex-col">
      {/* Mobile Header - visible only on mobile */}
      <MobileStudioHeader {...sidebarProps} />

      <div className="flex min-h-0 flex-1">
        {/* Desktop Sidebar - hidden on mobile */}
        <div className="hidden md:block">
          <StudioSidebar {...sidebarProps} />
        </div>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
