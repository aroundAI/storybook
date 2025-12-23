import type { Metadata } from 'next';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft } from 'lucide-react';

import { AssetGallery } from '@kit/assets/components';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { withI18n } from '~/lib/i18n/with-i18n';

import { CreateAssetButton } from './_components/create-asset-button';

interface AssetLibraryPageProps {
  params: Promise<{
    account: string;
    projectSlug: string;
  }>;
  searchParams: Promise<{
    tab?: 'character' | 'location' | 'voice';
  }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: AssetLibraryPageProps): Promise<Metadata> {
  const { projectSlug } = await params;
  const { tab } = await searchParams;
  const client = getSupabaseServerClient();

  const { data: project } = await client
    .from('projects')
    .select('name')
    .eq('slug', projectSlug)
    .single();

  const tabTitle =
    tab === 'location'
      ? 'Story World'
      : tab === 'voice'
        ? 'Voice Library'
        : 'Cast';

  return {
    title: project ? `${project.name} - ${tabTitle}` : tabTitle,
    description:
      'Manage characters, locations, and voice profiles for your project',
  };
}

async function AssetLibraryPage({
  params,
  searchParams,
}: AssetLibraryPageProps) {
  const { account, projectSlug } = await params;
  const { tab } = await searchParams;

  const client = getSupabaseServerClient();

  // Fetch project by slug
  const { data: project, error } = await client
    .from('projects')
    .select('id, name, slug')
    .eq('slug', projectSlug)
    .single();

  if (error || !project) {
    notFound();
  }

  const activeTab = tab ?? 'character';

  let title = 'Cast';
  let description = 'Characters in your story world';

  if (activeTab === 'location') {
    title = 'Story World';
    description = 'Locations and settings where your story takes place';
  } else if (activeTab === 'voice') {
    title = 'Voice Library';
    description = 'Voice profiles for your characters';
  }

  return (
    <>
      {/* Back Link */}
      <div className="px-6 pt-6">
        <Link
          href={`/home/${account}/studio/${project.slug}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm transition-colors"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Project
        </Link>
      </div>

      <PageHeader title={title} description={description}>
        <CreateAssetButton projectId={project.id} account={account} />
      </PageHeader>

      <PageBody>
        <AssetGallery projectId={project.id} initialTab={tab ?? 'character'} />
      </PageBody>
    </>
  );
}

export default withI18n(AssetLibraryPage);
