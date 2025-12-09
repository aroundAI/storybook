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

  // Verify project exists and belongs to the account in the URL
  const [{ data: project, error: projectError }, { data: accountData }] =
    await Promise.all([
      client
        .from('projects')
        .select('id, name, account_id')
        .eq('id', projectId)
        .single(),
      client.from('accounts').select('id').eq('slug', account).single(),
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
      <StudioSidebar project={project} account={account} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
