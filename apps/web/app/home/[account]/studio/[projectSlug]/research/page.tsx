import { notFound } from 'next/navigation';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ResearchHubPage } from './_components/research-hub-page';

interface ResearchPageProps {
  params: Promise<{
    account: string;
    projectSlug: string;
  }>;
}

export default async function ResearchPage({ params }: ResearchPageProps) {
  const { account, projectSlug } = await params;
  const client = getSupabaseServerClient();

  const { data: project, error } = await client
    .from('projects')
    .select('id, name, slug, metadata, account_id')
    .eq('slug', projectSlug)
    .single();

  if (error || !project) {
    notFound();
  }

  // Team-wide sources are added by the team's owners (KB-37); RLS enforces
  // it, this only decides whether to offer the choice.
  const { data: ownsTeam } = await client.rpc('has_role_on_account', {
    account_id: project.account_id,
    account_role: 'owner',
  });

  return (
    <ResearchHubPage
      projectId={project.id}
      projectSlug={projectSlug}
      account={account}
      canAddTeamSources={ownsTeam === true}
    />
  );
}
