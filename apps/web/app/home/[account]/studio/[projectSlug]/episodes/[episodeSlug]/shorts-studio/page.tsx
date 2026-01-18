import { notFound } from 'next/navigation';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ShortsStudioScreen } from './_components/shorts-studio-screen';

interface ShortsStudioPageProps {
  params: Promise<{
    account: string;
    projectSlug: string;
    episodeSlug: string;
  }>;
}

export default async function ShortsStudioPage({
  params,
}: ShortsStudioPageProps) {
  const { account, projectSlug, episodeSlug } = await params;

  const client = getSupabaseServerClient();

  // Fetch episode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: episode, error } = await (client as any)
    .from('episodes')
    .select(
      `
      id,
      title,
      project:projects!inner (
        id,
        slug,
        account_id
      )
    `,
    )
    .eq('slug', episodeSlug)
    .eq('project.slug', projectSlug)
    .single();

  if (error || !episode) {
    notFound();
  }

  return (
    <ShortsStudioScreen
      episodeId={episode.id}
      projectSlug={projectSlug}
      accountSlug={account}
    />
  );
}

export const metadata = {
  title: 'Shorts Studio',
  description: 'Generate and publish vertical clips',
};
