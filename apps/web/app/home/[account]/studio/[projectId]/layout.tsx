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

  // Verify project access
  const { data: project, error } = await client
    .from('projects')
    .select('id, name, account_id')
    .eq('id', projectId)
    .single();

  if (error || !project) {
    notFound();
  }

  return (
    <div className="flex h-full min-h-screen">
      <StudioSidebar project={project} account={account} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
