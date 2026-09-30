import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import { listCharacters } from '@kit/assets/character/queries';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { cached } from '~/lib/cache/data-cache';
import { withI18n } from '~/lib/i18n/with-i18n';

import { AssetCreateProvider } from './_components/asset-create-provider';
import { AssetLibraryGallery } from './_components/asset-library-gallery';
import { AssetsBreadcrumb } from './_components/assets-breadcrumb';
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

  const tabTitle = tab === 'location' ? 'Story World' : 'Cast';

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

  // Fetch initial character data server-side (no client-side loading freeze)
  let initialCharacters:
    | {
        characters: Awaited<ReturnType<typeof listCharacters>>['characters'];
        total: number;
        hasMore: boolean;
      }
    | undefined;

  if (activeTab === 'character') {
    try {
      initialCharacters = await listCharacters(project.id, { limit: 100 });
    } catch (err) {
      console.error(
        '[AssetLibraryPage] Failed to fetch initial characters:',
        err,
      );
      // If server-side fetch fails, the client-side hook will retry
    }
  }

  return (
    <AssetCreateProvider>
      <AssetsBreadcrumb
        account={account}
        projectSlug={project.slug}
        projectName={project.name}
      />

      <PageHeader title={title} description={description}>
        <CreateAssetButton />
      </PageHeader>

      <PageBody>
        <AssetLibraryGallery
          projectId={project.id}
          accountId={accountResult.id}
          initialTab={tab ?? 'character'}
          initialCharacters={initialCharacters}
        />
      </PageBody>
    </AssetCreateProvider>
  );
}

export default withI18n(AssetLibraryPage);
