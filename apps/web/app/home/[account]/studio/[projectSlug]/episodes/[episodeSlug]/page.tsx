import { redirect } from 'next/navigation';

interface EpisodeRootPageProps {
  params: Promise<{
    account: string;
    projectSlug: string;
    episodeSlug: string;
  }>;
}

export default async function EpisodeRootPage({
  params,
}: EpisodeRootPageProps) {
  const { account, projectSlug, episodeSlug } = await params;

  // Redirect to the ideation tab by default
  redirect(
    `/home/${account}/studio/${projectSlug}/episodes/${episodeSlug}/ideation`,
  );
}
