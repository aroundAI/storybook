import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { cached } from '~/lib/cache/data-cache';
import { withI18n } from '~/lib/i18n/with-i18n';

import { OverviewContent } from './_components/overview-content';

interface StudioProjectPageProps {
  params: Promise<{
    account: string;
    projectSlug: string;
  }>;
}

export async function generateMetadata({
  params,
}: StudioProjectPageProps): Promise<Metadata> {
  const { projectSlug } = await params;
  const client = getSupabaseServerClient();

  const { data: project } = await client
    .from('projects')
    .select('name')
    .eq('slug', projectSlug)
    .single();

  return {
    title: project?.name ?? 'Project Dashboard',
    description: 'Manage your film project',
  };
}

// ISR: Revalidate every 60 seconds
export const revalidate = 60;

// Cache TTLs in seconds
const CACHE_TTL = {
  project: 3600, // 1 hour
  counts: 300, // 5 minutes
  episodes: 300, // 5 minutes
  analytics: 600, // 10 minutes
};

async function StudioProjectPage({ params }: StudioProjectPageProps) {
  const { account, projectSlug } = await params;
  const client = getSupabaseServerClient();

  // Fetch project with caching (1 hour TTL)
  const projectResult = await cached(
    `project:${projectSlug}`,
    async () => {
      const { data, error } = await client
        .from('projects')
        .select('id, name, slug, description, metadata, created_at')
        .eq('slug', projectSlug)
        .single();
      return { data, error };
    },
    CACHE_TTL.project,
  );

  if (projectResult.error || !projectResult.data) {
    notFound();
  }

  const project = projectResult.data;

  // Fetch counts and episode data in parallel with caching
  // NOTE: Analytics removed - was causing N+1 queries (30+ DB calls)
  // The overview page only needs view/engagement counts which we'll fetch separately
  const [
    { count: characterCount },
    { count: locationCount },
    { count: episodeCount },
    recentEpisodes,
    { count: publishedCount },
    analyticsSnapshot,
  ] = await Promise.all([
    // Character count (5 min cache)
    cached(
      `project:${project.id}:character-count`,
      async () => {
        const result = await client
          .from('assets')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', project.id)
          .eq('type', 'character')
          .is('deleted_at', null);
        return result;
      },
      CACHE_TTL.counts,
    ),
    // Location count (5 min cache)
    cached(
      `project:${project.id}:location-count`,
      async () => {
        const result = await client
          .from('assets')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', project.id)
          .eq('type', 'location')
          .is('deleted_at', null);
        return result;
      },
      CACHE_TTL.counts,
    ),
    // Episode count (5 min cache)
    cached(
      `project:${project.id}:episode-count`,
      async () => {
        const result = await client
          .from('episodes')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', project.id)
          .is('deleted_at', null);
        return result;
      },
      CACHE_TTL.counts,
    ),
    // Recent episodes with status (5 min cache) - uses status field instead of JSON blobs
    cached(
      `project:${project.id}:recent-episodes`,
      async () => {
        const { data } = await client
          .from('episodes')
          .select(
            'id, slug, title, number, status, updated_at',
          )
          .eq('project_id', project.id)
          .is('deleted_at', null)
          .order('updated_at', { ascending: false })
          .limit(5); // Fetch 5 for production status calculation
        return data;
      },
      CACHE_TTL.episodes,
    ),
    // Published content count (lightweight - just count publishes)
    cached(
      `project:${project.id}:publish-count`,
      async () => {
        const result = await client
          .from('publishes')
          .select('id, episodes!inner(project_id)', { count: 'exact', head: true })
          .eq('episodes.project_id', project.id);
        return result;
      },
      CACHE_TTL.counts,
    ),
    // Lightweight analytics snapshot (10 min cache)
    // Uses aggregation instead of N+1 queries
    cached(
      `project:${project.id}:analytics-snapshot`,
      async () => {
        // Get latest analytics for all publishes in this project with a single query
        const { data } = await client
          .from('content_analytics')
          .select(`
            views,
            likes,
            comments,
            publishes!inner(
              episodes!inner(
                project_id
              )
            )
          `)
          .eq('publishes.episodes.project_id', project.id)
          .order('snapshot_date', { ascending: false })
          .limit(100); // Get latest snapshots

        if (!data || data.length === 0) {
          return { totalViews: 0, totalLikes: 0, totalComments: 0 };
        }

        // Aggregate totals (take max per publish since they're cumulative)
        const publishTotals = new Map<string, { views: number; likes: number; comments: number }>();
        for (const row of data) {
          // Use first occurrence (latest) for each publish
          const key = JSON.stringify(row.publishes);
          if (!publishTotals.has(key)) {
            publishTotals.set(key, {
              views: row.views || 0,
              likes: row.likes || 0,
              comments: row.comments || 0,
            });
          }
        }

        let totalViews = 0;
        let totalLikes = 0;
        let totalComments = 0;
        for (const totals of publishTotals.values()) {
          totalViews += totals.views;
          totalLikes += totals.likes;
          totalComments += totals.comments;
        }

        return { totalViews, totalLikes, totalComments };
      },
      CACHE_TTL.analytics,
    ),
  ]);

  // Extract metadata
  const metadata = (project.metadata ?? {}) as {
    genre?: string;
    targetAudience?: string;
    format?: string;
    coverImageUrl?: string;
  };

  const baseUrl = `/home/${account}/studio/${project.slug}`;

  // Calculate production status from recent episodes (approximation)
  // Full status would require fetching all episodes - deferred to episodes page
  // Status order: draft → story → storyboard → visual-studio → audio-studio → review → published
  const statusOrder = ['draft', 'story', 'storyboard', 'visual-studio', 'audio-studio', 'review', 'published'];

  // Helper to check if episode has reached a status or beyond
  const hasReachedStatus = (ep: { status: string }, minStatus: string) => {
    const currentIndex = statusOrder.indexOf(ep.status);
    const minIndex = statusOrder.indexOf(minStatus);
    return currentIndex >= minIndex;
  };

  const productionStatus = {
    scriptsComplete:
      recentEpisodes?.filter((e) => hasReachedStatus(e, 'story')).length ?? 0,
    storyboardsComplete:
      recentEpisodes?.filter((e) => hasReachedStatus(e, 'storyboard')).length ?? 0,
    visualsComplete:
      recentEpisodes?.filter((e) => hasReachedStatus(e, 'visual-studio')).length ?? 0,
    totalEpisodes: episodeCount ?? 0,
  };

  // Build lightweight analytics object for UI
  const analytics = analyticsSnapshot ? {
    totalViews: analyticsSnapshot.totalViews,
    totalLikes: analyticsSnapshot.totalLikes,
    totalComments: analyticsSnapshot.totalComments,
    avgEngagementRate: analyticsSnapshot.totalViews > 0
      ? ((analyticsSnapshot.totalLikes + analyticsSnapshot.totalComments) / analyticsSnapshot.totalViews) * 100
      : 0,
    contentCount: publishedCount ?? 0,
  } : null;

  // Map recent episodes to include stage info (derived from status field)
  const mappedEpisodes =
    recentEpisodes?.map((ep) => {
      // Map status to display stage
      let stage: 'draft' | 'story' | 'screenplay' | 'shots' = 'draft';
      if (hasReachedStatus(ep, 'visual-studio')) stage = 'shots';
      else if (hasReachedStatus(ep, 'storyboard')) stage = 'screenplay';
      else if (hasReachedStatus(ep, 'story')) stage = 'story';

      return {
        id: ep.id,
        title: ep.title,
        number: ep.number,
        updated_at: ep.updated_at,
        stage,
      };
    }) ?? [];

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-7xl p-8">
        <OverviewContent
          project={{
            id: project.id,
            name: project.name,
            description: project.description,
          }}
          metadata={metadata}
          episodeCount={episodeCount ?? 0}
          characterCount={characterCount ?? 0}
          locationCount={locationCount ?? 0}
          recentEpisodes={mappedEpisodes}
          productionStatus={productionStatus}
          analytics={analytics}
          baseUrl={baseUrl}
        />
      </div>
    </div>
  );
}

export default withI18n(StudioProjectPage);
