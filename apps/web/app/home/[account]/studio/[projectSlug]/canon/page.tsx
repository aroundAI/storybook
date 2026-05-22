/**
 * Canon / Narrative Arcs Page
 *
 * Project-level page displaying all narrative threads across all episodes.
 * Provides a comprehensive view of plot threads, character arcs, mysteries,
 * and thematic threads with filtering and status tracking.
 */
import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import type { NarrativeThread } from '@kit/episodes/lib';
import { getAllThreadsAction } from '@kit/episodes/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { CanonDashboard } from './_components/canon-dashboard';

interface PageParams {
  params: Promise<{
    account: string;
    projectSlug: string;
  }>;
}

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { projectSlug } = await params;
  const client = getSupabaseServerClient();

  const { data: project } = await client
    .from('projects')
    .select('name')
    .eq('slug', projectSlug)
    .single();

  return {
    title: project?.name
      ? `${project.name} — Narrative Arcs`
      : 'Narrative Arcs',
    description:
      'View and track all narrative threads, plot arcs, and story continuity across episodes.',
  };
}

export default async function CanonPage({ params }: PageParams) {
  const { projectSlug } = await params;
  const client = getSupabaseServerClient();

  const { data: project } = await client
    .from('projects')
    .select('id, name')
    .eq('slug', projectSlug)
    .single();

  if (!project) {
    notFound();
  }

  let threads: NarrativeThread[];
  try {
    threads = await getAllThreadsAction({ projectId: project.id });
  } catch {
    threads = [];
  }

  return (
    <>
      <PageHeader
        title="Narrative Arcs"
        description="Track plot threads, character arcs, and story continuity across episodes."
      />
      <PageBody>
        <CanonDashboard threads={threads} projectName={project.name} />
      </PageBody>
    </>
  );
}
