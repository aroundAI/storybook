import { notFound } from 'next/navigation';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

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

  // Verify project exists and fetch recent projects for switcher
  const [{ data: project, error: projectError }, { data: accountData }, { data: recentProjects }] =
    await Promise.all([
      client
        .from('projects')
        .select('id, name, account_id')
        .eq('id', projectId)
        .single(),
      client.from('accounts').select('id').eq('slug', account).single(),
      // Fetch 5 most recent projects for the switcher
      client
        .from('projects')
        .select('id, name, updated_at')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(6),
    ]);

  if (projectError || !project) {
    notFound();
  }

  // Verify project belongs to the account from URL (explicit auth check)
  if (!accountData || project.account_id !== accountData.id) {
    notFound();
  }

  return (
    <div className="flex h-full min-h-screen">
      <StudioSidebar
        project={project}
        account={account}
        recentProjects={(recentProjects ?? []).map((p) => ({
          ...p,
          updated_at: p.updated_at ?? undefined,
        }))}
      />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
