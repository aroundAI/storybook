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
    .select('id, name, slug, metadata')
    .eq('slug', projectSlug)
    .single();

  if (error || !project) {
    notFound();
  }

  return (
    <ResearchHubPage
      projectId={project.id}
      projectSlug={projectSlug}
      account={account}
    />
  );
}
