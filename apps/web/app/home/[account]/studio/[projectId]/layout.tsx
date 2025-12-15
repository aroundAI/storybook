import { notFound } from 'next/navigation';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

import { StudioSidebar } from './_components/studio-sidebar';

interface StudioProjectLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    account: string;
    projectId: string;
  }>;
}

export default async function StudioProjectLayout({
  children,
  params,
}: StudioProjectLayoutProps) {
  const { account, projectId } = await params;
  const client = getSupabaseServerClient();

  // Get user data for the unified footer
  const user = await requireUserInServerComponent();

  // Verify project exists and fetch recent projects for switcher
  const [
    { data: project, error: projectError },
    { data: accountData },
    { data: recentProjects },
    { count: episodesCount },
    { count: charactersCount },
    { count: locationsCount },
  ] = await Promise.all([
    client
      .from('projects')
      .select('id, name, account_id')
      .eq('id', projectId)
      .single(),
    client.from('accounts').select('id').eq('slug', account).single(),
    // Fetch all projects for this account for the switcher
    client
      .from('projects')
      .select('id, name, updated_at, account_id')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(20),
    // Fetch counts for sidebar badges
    client
      .from('episodes')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('deleted_at', null),
    client
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('type', 'character')
      .is('deleted_at', null),
    client
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('type', 'location')
      .is('deleted_at', null),
  ]);

  if (projectError || !project) {
    notFound();
  }

  // Verify project belongs to the account from URL (explicit auth check)
  if (!accountData || project.account_id !== accountData.id) {
    notFound();
  }

  return (
    <div className="flex h-screen">
      <StudioSidebar
        project={project}
        account={account}
        recentProjects={(recentProjects ?? [])
          .filter((p) => p.account_id === accountData?.id)
          .map((p) => ({
            id: p.id,
            name: p.name,
            updated_at: p.updated_at ?? undefined,
          }))}
        user={user}
        counts={{
          episodes: episodesCount ?? undefined,
          characters: charactersCount ?? undefined,
          locations: locationsCount ?? undefined,
        }}
      />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
