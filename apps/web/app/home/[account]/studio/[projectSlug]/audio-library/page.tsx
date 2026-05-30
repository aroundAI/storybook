import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { withI18n } from '~/lib/i18n/with-i18n';

import { AudioLibraryClient } from './_components';

interface AudioLibraryPageProps {
  params: Promise<{
    account: string;
    projectSlug: string;
  }>;
}

export async function generateMetadata({
  params,
}: AudioLibraryPageProps): Promise<Metadata> {
  const { projectSlug } = await params;
  const client = getSupabaseServerClient();

  const { data: project } = await client
    .from('projects')
    .select('name')
    .eq('slug', projectSlug)
    .single();

  return {
    title: project ? `${project.name} - Audio Library` : 'Audio Library',
    description: 'Manage music and sound effects for your project',
  };
}

async function AudioLibraryPage({ params }: AudioLibraryPageProps) {
  const { account, projectSlug } = await params;

  const client = getSupabaseServerClient();

  // Fetch account ID and project in parallel
  const [{ data: accountRecord }, { data: project, error }] = await Promise.all(
    [
      client.from('accounts').select('id').eq('slug', account).single(),
      client
        .from('projects')
        .select('id, name, slug')
        .eq('slug', projectSlug)
        .single(),
    ],
  );

  if (error || !project || !accountRecord) {
    notFound();
  }

  // Fetch audio assets
  // Note: audio_assets table may not exist yet - handle gracefully
  let assets: Array<{
    id: string;
    name: string | null;
    audio_type: string;
    prompt: string;
    file_url: string | null;
    duration_seconds: number | null;
    status: string;
    usage_count: number | null;
    created_at: string;
  }> = [];

  try {
    const { data: audioAssets } = await client
      .from('audio_assets')
      .select(
        'id, name, audio_type, prompt, file_url, duration_seconds, status, usage_count, created_at',
      )
      .eq('project_id', project.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (audioAssets) {
      assets = audioAssets;
    }
  } catch {
    // Table may not exist yet - that's fine
    console.log('audio_assets table not found or query failed');
  }

  // Transform to client format
  const clientAssets = assets.map((a) => ({
    id: a.id,
    name: a.name,
    audioType: a.audio_type as 'music' | 'sfx',
    prompt: a.prompt,
    fileUrl: a.file_url,
    durationSeconds: a.duration_seconds,
    status: a.status as 'pending' | 'processing' | 'completed' | 'failed',
    usageCount: a.usage_count ?? 0,
    createdAt: a.created_at,
  }));

  return (
    <>
      <PageHeader
        title="Audio Library"
        description="Music and sound effects for your project"
      />
      <PageBody>
        <AudioLibraryClient
          projectId={project.id}
          initialAssets={clientAssets}
        />
      </PageBody>
    </>
  );
}

export default withI18n(AudioLibraryPage);
