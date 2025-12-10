import type { Metadata } from 'next';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, Film } from 'lucide-react';

import type {
  EpisodeMetadata,
  EpisodeStatus,
  ScreenplayData,
  ShotListData,
  StoryData,
} from '@kit/episodes/types';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Card, CardContent } from '@kit/ui/card';
import { PageBody, PageHeader } from '@kit/ui/page';

import { withI18n } from '~/lib/i18n/with-i18n';

import { CreateEpisodeDialog } from './_components/create-episode-dialog';
import { EpisodeCard } from './_components/episode-card';

interface EpisodesPageProps {
  params: Promise<{
    account: string;
    projectId: string;
  }>;
}

export async function generateMetadata({
  params,
}: EpisodesPageProps): Promise<Metadata> {
  const { projectId } = await params;
  const client = getSupabaseServerClient();

  const { data: project } = await client
    .from('projects')
    .select('name')
    .eq('id', projectId)
    .single();

  return {
    title: project ? `${project.name} - Episodes` : 'Episodes',
    description: 'Manage episodes for your project',
  };
}

async function EpisodesPage({ params }: EpisodesPageProps) {
  const { account, projectId } = await params;
  const client = getSupabaseServerClient();

  // Fetch project and episodes in parallel for optimal performance
  const [projectResult, episodesResult] = await Promise.all([
    client.from('projects').select('id, name').eq('id', projectId).single(),
    client
      .from('episodes')
      .select('*')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('number', { ascending: true }),
  ]);

  const { data: project, error: projectError } = projectResult;
  const { data: episodes, error: episodesError } = episodesResult;

  if (projectError || !project) {
    notFound();
  }

  if (episodesError) {
    throw new Error('Failed to load episodes');
  }

  return (
    <>
      {/* Back Link */}
      <div className="px-6 pt-6">
        <Link
          href={`/home/${account}/studio/${projectId}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm transition-colors"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Project
        </Link>
      </div>

      <PageHeader
        title="Episodes"
        description="Manage your project's episodes, stories, and screenplays"
      >
        <CreateEpisodeDialog projectId={projectId} account={account} />
      </PageHeader>

      <PageBody>
        {episodes && episodes.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {episodes.map((episode) => (
              <EpisodeCard
                key={episode.id}
                episode={{
                  id: episode.id,
                  projectId: episode.project_id,
                  seasonId: episode.season_id,
                  number: episode.number,
                  title: episode.title,
                  description: episode.description,
                  status: episode.status as EpisodeStatus,
                  durationSeconds: episode.duration_seconds,
                  thumbnailUrl: episode.thumbnail_url,
                  finalVideoUrl: episode.final_video_url,
                  storyData: episode.story_data as StoryData | null,
                  screenplayData:
                    episode.screenplay_data as ScreenplayData | null,
                  shotList: episode.shot_list as ShotListData | null,
                  metadata: episode.metadata as EpisodeMetadata | null,
                  version: episode.version,
                  createdAt: episode.created_at,
                  updatedAt: episode.updated_at,
                  deletedAt: episode.deleted_at,
                }}
                account={account}
                projectId={projectId}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="bg-muted mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                <Film className="text-muted-foreground h-8 w-8" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">No episodes yet</h3>
              <p className="text-muted-foreground mb-6 max-w-sm text-center text-sm">
                Get started by creating your first episode. Each episode can
                have its own story, screenplay, and video content.
              </p>
              <CreateEpisodeDialog projectId={projectId} account={account} />
            </CardContent>
          </Card>
        )}
      </PageBody>
    </>
  );
}

export default withI18n(EpisodesPage);
