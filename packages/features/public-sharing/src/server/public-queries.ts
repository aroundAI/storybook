import { getLogger } from '@kit/shared/logger';
import { fetchAllRows } from '@kit/shared/pagination';
import { Database } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

export type PublicAccount = Pick<
  Database['public']['Tables']['accounts']['Row'],
  'id' | 'name' | 'slug' | 'picture_url' | 'public_profile'
>;

export type PublicProject = Database['public']['Tables']['projects']['Row'] & {
  account: {
    id: string;
    name: string;
    slug: string;
  };
};

export type PublicEpisode = Database['public']['Tables']['episodes']['Row'] & {
  project: {
    id: string;
    name: string;
    public_slug: string | null;
    visibility: string;
    account: {
      id: string;
      name: string;
      slug: string | null;
    };
  };
  localized_videos: Record<
    string,
    {
      youtube?: { url: string };
      facebook?: { url: string };
    }
  > | null;
};

/**
 * Get a public company/account by slug.
 * Only returns if the account has public access enabled.
 */
export async function getPublicCompany(slug: string) {
  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from('accounts')
    .select('id, name, slug, picture_url, public_profile')
    .eq('slug', slug)
    // We check if public_profile->is_public is true
    // Note: We need to cast the filter because Supabase generic types for JSONB are loose
    .eq('public_profile->>is_public', 'true')
    .single();

  if (error) {
    return null;
  }

  return data as PublicAccount;
}

/**
 * Get a public project by account ID and project slug.
 * accessible if visibility is 'public' OR 'unlisted'.
 */
export async function getPublicProject(accountId: string, projectSlug: string) {
  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from('projects')
    .select(
      `
      *,
      account:accounts!inner(id, name, slug)
    `,
    )
    .eq('account_id', accountId)
    .eq('public_slug', projectSlug)
    // Allow public or unlisted. Private is excluded.
    .in('visibility', ['public', 'unlisted'])
    .single();

  if (error) return null;

  return data as unknown as PublicProject;
}

/**
 * List ALL public projects for a company.
 * Only returns 'public' visibility. 'Unlisted' are hidden from lists.
 */
export async function getPublicProjects(
  accountId: string,
): Promise<PublicProject[]> {
  const client = getSupabaseServerClient();

  // Paged, like its sibling getPublicEpisodes: an unpaged read stops at the
  // server's row cap with HTTP 200 and no error, so a company past that
  // would silently lose the rest of its public listing.
  //
  // `created_at` leads so the newest-first display order is preserved, but
  // it is not unique — `id` is the tiebreak that makes the page boundaries
  // deterministic. Without it, ties can skip and duplicate rows.
  //
  // Failures are logged and degrade to an empty list rather than throwing:
  // the only caller renders this inside a public company page with a bare
  // await, so a throw would 500 the whole page instead of dropping one
  // section. (getSitemapData throws instead, because its route was given an
  // explicit degrade path.)
  try {
    const data = await fetchAllRows(
      (from, to) =>
        client
          .from('projects')
          .select(
            `
      *,
      account:accounts!inner(id, name, slug)
    `,
          )
          .eq('account_id', accountId)
          .eq('visibility', 'public')
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      'public projects',
    );

    return data as unknown as PublicProject[];
  } catch (error) {
    const logger = await getLogger();

    logger.error(
      {
        name: 'public-projects',
        accountId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to load public projects',
    );

    return [];
  }
}

/**
 * Get a public episode by project ID and episode slug.
 * accessible if visibility is 'public' OR 'unlisted' (or 'inherit' if project is accessible).
 */
export async function getPublicEpisode(
  projectId: string,
  episodeSlug: string,
): Promise<PublicEpisode | null> {
  const client = getSupabaseServerClient();

  // First fetch the episode to check its visibility
  const { data: episode, error } = await client
    .from('episodes')
    .select(
      `
      *,
      project:projects!inner(
        id,
        name,
        public_slug,
        visibility,
        account:accounts!inner(id, name, slug)
      )
    `,
    )
    .eq('project_id', projectId)
    .eq('slug', episodeSlug)
    .single();

  if (error || !episode) return null;

  // Resolve effective visibility
  let effectiveVisibility = episode.visibility;
  if (effectiveVisibility === 'inherit') {
    // If inherit, use project visibility
    // If project is private, then episode is private (but query normally filters project logic upstream? No, we need to check here)
    effectiveVisibility = episode.project.visibility;
  }

  if (effectiveVisibility === 'private') {
    return null;
  }

  // If we are here, effectiveVisibility is 'public' or 'unlisted'.
  return episode as unknown as PublicEpisode;
}

/**
 * List public episodes for a project.
 * Only returns 'public' visibility (or 'inherit' where project is public).
 * Only returns RELEASED episodes (those with at least one localized video).
 * Grouping by season is usually done in UI or via a transform, here we return flat list.
 */
export async function getPublicEpisodes(
  projectId: string,
): Promise<PublicEpisode[]> {
  const client = getSupabaseServerClient();

  // Paged: this is the public episode list for a project, so truncation
  // would drop episodes off a public page with no error anywhere.
  try {
    const data = await fetchAllRows(
      (from, to) =>
        client
          .from('episodes')
          .select(
            `
      *,
      project:projects!inner(
        id,
        name,
        public_slug,
        visibility,
        account:accounts!inner(id, name, slug)
      )
    `,
          )
          .eq('project_id', projectId)
          // Allow 'public' AND 'inherit' (exclude 'unlisted' and 'private')
          .in('visibility', ['public', 'inherit'])
          // Ensure episode has a slug (to prevent /e/null URLs)
          .not('slug', 'is', null)
          // Only show RELEASED episodes (those with content in localized_videos)
          .not('localized_videos', 'is', null)
          .neq('localized_videos', '{}')
          .order('number', { ascending: true })
          .order('id')
          .range(from, to),
      'public episodes',
    );

    return data as unknown as PublicEpisode[];
  } catch (error) {
    // Logged rather than swallowed, and degraded rather than thrown, for
    // the same reason as getPublicProjects above: the caller is a public
    // page render.
    const logger = await getLogger();

    logger.error(
      {
        name: 'public-episodes',
        projectId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to load public episodes',
    );

    return [];
  }
}

export type LanguagePlatformUrls = {
  youtubeUrl: string | null;
  facebookUrl: string | null;
};

export type EpisodePlatformUrlsByLanguage = {
  languages: string[];
  defaultLanguage: string | null;
  urlsByLanguage: Record<string, LanguagePlatformUrls>;
};

/**
 * Get the platform URLs for an episode, grouped by language.
 * Returns YouTube and Facebook URLs from the localized_videos column.
 * Priority for embedding: YouTube > Facebook
 */
export async function getEpisodePlatformUrls(
  episodeId: string,
): Promise<EpisodePlatformUrlsByLanguage> {
  const client = getSupabaseServerClient();

  const { data: episode } = await client
    .from('episodes')
    .select('localized_videos')
    .eq('id', episodeId)
    .single();

  const urlsByLanguage: Record<string, LanguagePlatformUrls> = {};

  if (episode?.localized_videos) {
    // localized_videos is Record<string, { youtube?: { url: string }, facebook?: { url: string } }>
    const videos = episode.localized_videos as Record<
      string,
      { youtube?: { url: string }; facebook?: { url: string } }
    >;

    for (const [lang, platforms] of Object.entries(videos)) {
      if (!urlsByLanguage[lang]) {
        urlsByLanguage[lang] = { youtubeUrl: null, facebookUrl: null };
      }

      if (platforms.youtube?.url) {
        urlsByLanguage[lang]!.youtubeUrl = platforms.youtube.url;
      }

      if (platforms.facebook?.url) {
        urlsByLanguage[lang]!.facebookUrl = platforms.facebook.url;
      }
    }
  }

  const languages = Object.keys(urlsByLanguage).sort();

  // Default to 'en' if available, otherwise first language
  const defaultLanguage = languages.includes('en')
    ? 'en'
    : languages[0] || null;

  return { languages, defaultLanguage, urlsByLanguage };
}

/**
 * Fetch all public data for sitemap generation.
 */
export async function getSitemapData() {
  const client = getSupabaseServerClient();

  // Paged rather than capped. These were `.limit(1000/2000/5000)`, but
  // PostgREST's own `max_rows` is 1000, so the larger two could never be
  // honoured and the sitemap quietly stopped at a thousand URLs — the kind
  // of truncation that costs indexing without producing any error.
  //
  // Every page orders by `id`. `public_slug` and `accounts.slug` are both
  // nullable (and `slug` is required to be NULL on personal accounts), so
  // ordering by them leaves rows tied on NULL in arbitrary per-request
  // order — and `.range()` boundaries over an unstable sort skip and
  // duplicate rows, which would drop and repeat sitemap URLs on every
  // generation. `id` is the primary key: unique and non-null.
  //
  // The NULL-slug rows are also filtered out in SQL rather than in the
  // route, so a page carries only rows that can actually produce a URL.
  const accounts = await fetchAllRows(
    (from, to) =>
      client
        .from('accounts')
        .select('slug, updated_at')
        .eq('public_profile->>is_public', 'true')
        .not('slug', 'is', null)
        .order('id')
        .range(from, to),
    'sitemap accounts',
  );

  // 2. Public Projects
  const projects = await fetchAllRows(
    (from, to) =>
      client
        .from('projects')
        .select(
          `
        public_slug,
        updated_at,
        account:accounts!inner(slug)
      `,
        )
        .eq('visibility', 'public')
        .not('public_slug', 'is', null)
        .order('id')
        .range(from, to),
    'sitemap projects',
  );

  // 3. Public Episodes
  //
  // The parent project must be public. `episodes.visibility` defaults to
  // 'inherit' and `projects.visibility` defaults to 'private', so matching
  // on the episode alone selects essentially the whole episodes table —
  // including episodes under private projects, which were then emitted into
  // the public sitemap whenever both slugs happened to be set. The URL
  // embeds the project slug (`/@account/project/e/episode`), so an episode
  // is only publicly reachable when its project is public; requiring that
  // here is what makes the read bounded as well as correct.
  const episodes = await fetchAllRows(
    (from, to) =>
      client
        .from('episodes')
        .select(
          `
        public_slug,
        updated_at,
        project:projects!inner(
          public_slug,
          account:accounts!inner(slug)
        )
      `,
        )
        .in('visibility', ['public', 'inherit'])
        .eq('project.visibility', 'public')
        .not('public_slug', 'is', null)
        .order('id')
        .range(from, to),
    'sitemap episodes',
  );

  return {
    accounts: accounts || [],
    projects: projects || [],
    episodes: episodes || [],
  };
}
