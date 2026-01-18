import type { Metadata } from 'next';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft } from 'lucide-react';

import { AssetGallery } from '@kit/assets/components';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { cached } from '~/lib/cache/data-cache';
import { withI18n } from '~/lib/i18n/with-i18n';

import { CreateAssetButton } from './_components/create-asset-button';

// ISR: Revalidate every 60 seconds
export const revalidate = 60;

interface AssetLibraryPageProps {
  params: Promise<{
    account: string;
    projectSlug: string;
  }>;
  searchParams: Promise<{
    tab?: 'character' | 'location';
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

  // Fetch account and project with caching
  const [accountResult, projectResult] = await Promise.all([
    // Account lookup (30 min cache - rarely changes)
    cached(
      `account:slug:${account}`,
      async () => {
        const { data } = await client
          .from('accounts')
          .select('id')
          .eq('slug', account)
          .single();
        return data;
      },
      1800,
    ),
    // Project lookup (1 hour cache)
    cached(
      `project:slug:${projectSlug}`,
      async () => {
        const { data, error } = await client
          .from('projects')
          .select('id, name, slug')
          .eq('slug', projectSlug)
          .single();
        return { data, error };
      },
      3600,
    ),
  ]);

  if (projectResult.error || !projectResult.data || !accountResult) {
    notFound();
  }

  const project = projectResult.data;

  const activeTab = tab ?? 'character';

  let title = 'Cast';
  let description = 'Characters in your story world';

  if (activeTab === 'location') {
    title = 'Story World';
    description = 'Locations and settings where your story takes place';
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
        <CreateAssetButton
          projectId={project.id}
          accountId={accountResult.id}
          account={account}
        />
      </PageHeader>

      <PageBody>
        <AssetGallery
          projectId={project.id}
          accountId={accountResult.id}
          initialTab={tab ?? 'character'}
        />
      </PageBody>
    </>
  );
}

export default withI18n(AssetLibraryPage);
