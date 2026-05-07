import { notFound } from 'next/navigation';

import { AddFactForm } from '@kit/episodes';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { loadTeamWorkspace } from '../../../../../_lib/server/team-account-workspace.loader';

interface AddFactPageProps {
  params: Promise<{ account: string; projectSlug: string }>;
}

export const generateMetadata = async ({ params }: AddFactPageProps) => {
  const { projectSlug } = await params;
  const client = getSupabaseServerClient();
  const { data: project } = await client
    .from('projects')
    .select('name')
    .eq('slug', projectSlug)
    .single();

  return {
    title: project ? `${project.name} - Add Fact` : 'Add Fact',
  };
};

async function AddFactPage({ params }: AddFactPageProps) {
  const { account, projectSlug } = await params;

  await loadTeamWorkspace(account);

  const client = getSupabaseServerClient();

  const { data: project, error: projectError } = await client
    .from('projects')
    .select('id')
    .eq('slug', projectSlug)
    .single();

  if (projectError || !project) {
    notFound();
  }

  const basePath = `/home/${account}/studio/${projectSlug}/settings/facts`;

  return (
    <div className="mx-auto max-w-2xl px-1">
      <AddFactForm projectId={project.id} basePath={basePath} />
    </div>
  );
}

export default AddFactPage;
