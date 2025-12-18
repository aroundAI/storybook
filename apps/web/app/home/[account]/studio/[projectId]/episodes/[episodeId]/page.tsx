import { redirect } from 'next/navigation';

interface EpisodeRootPageProps {
  params: Promise<{
    account: string;
    projectId: string;
    episodeId: string;
  }>;
}

export default async function EpisodeRootPage({
  params,
}: EpisodeRootPageProps) {
  const { account, projectId, episodeId } = await params;

  // Redirect to the ideation tab by default
  redirect(
    `/home/${account}/studio/${projectId}/episodes/${episodeId}/ideation`,
  );
}
