import { getLogger } from '@kit/shared/logger';
import { fetchAllRows } from '@kit/shared/pagination';
import { Database } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/*
 * Every read here is made by whoever is viewing a public page, usually a
 * visitor who is not signed in (`anon`). Since KB-85/88 they read three
 * owner-rights views and three lookups, and nothing else:
 *
 *   public_accounts, public_projects, public_episodes
 *       what may be LISTED: public rows only, public columns only
 *   get_shared_project, get_shared_project_episodes, get_shared_episode
 *       what opens by its exact LINK: public or unlisted
 *
 * The base tables are for members. See
 * apps/web/supabase/migrations/20260925083724_kb85-kb88-anon-public-pages.sql
 */

type AccountRow = Database['public']['Tables']['accounts']['Row'];
type ProjectRow = Database['public']['Tables']['projects']['Row'];
type EpisodeRow = Database['public']['Tables']['episodes']['Row'];

export type PublicAccount = Pick<
  AccountRow,
  'id' | 'name' | 'slug' | 'picture_url' | 'public_profile'
>;

// The views carry the base columns, but Postgres reports every view column
// as nullable. These are the base tables' own types for the same columns.
export type PublicProject = Pick<
  ProjectRow,
  | 'id'
  | 'account_id'
  | 'name'
  | 'description'
  | 'public_slug'
  | 'visibility'
  | 'metadata'
  | 'seo_metadata'
  | 'created_at'
  | 'updated_at'
> & {
  account: {
    id: string;
    name: string;
    slug: string;
  };
};

type LocalizedVideos = Record<
  string,
  {
    youtube?: { url: string };
    facebook?: { url: string };
  }
>;

export type PublicEpisode = Pick<
  EpisodeRow,
  | 'id'
  | 'project_id'
  | 'number'
  | 'title'
  | 'description'
  | 'duration_seconds'
  | 'thumbnail_url'
  | 'slug'
  | 'public_slug'
  | 'visibility'
  | 'seo_metadata'
  | 'created_at'
  | 'updated_at'
> & {
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
  localized_videos: LocalizedVideos | null;
};

type ProjectViewRow = Database['public']['Views']['public_projects']['Row'];
type EpisodeViewRow = Database['public']['Views']['public_episodes']['Row'];

/**
 * A missing row is a quiet 404. A failed read is not: KB-88 hid behind this
 * for months, because "permission denied for schema public" and a slug
 * nobody published looked the same.
 */
async function logReadFailure(
  name: string,
  error: { code?: string; message: string },
  context: Record<string, unknown>,
) {
  const logger = await getLogger();

  logger.error(
    { name, code: error.code, error: error.message, ...context },
    'Public read failed',
  );
}

function toPublicProject(
  row: ProjectViewRow,
  company: PublicAccount,
): PublicProject {
  return {
    ...(row as Omit<PublicProject, 'account'>),
    account: {
      id: company.id,
      name: company.name,
      slug: company.slug ?? row.account_slug ?? '',
    },
  };
}

function toPublicEpisode(
  row: EpisodeViewRow,
  project: PublicProject,
): PublicEpisode {
  return {
    ...(row as Omit<PublicEpisode, 'project'>),
    localized_videos: row.localized_videos as LocalizedVideos | null,
    project: {
      id: project.id,
      name: project.name,
      public_slug: project.public_slug,
      visibility: project.visibility ?? 'public',
      account: project.account,
    },
  };
}

/**
 * Get a public company/account by slug.
 * Only returns if the account has public access enabled.
 */
export async function getPublicCompany(
  slug: string,
): Promise<PublicAccount | null> {
  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from('public_accounts')
    .select('id, name, slug, picture_url, public_profile')
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    await logReadFailure('public-company', error, { slug });
    return null;
  }

  return data as PublicAccount | null;
}

/**
 * A project by its link: public or unlisted.
 */
export async function getPublicProject(
  company: PublicAccount,
  projectSlug: string,
): Promise<PublicProject | null> {
  const client = getSupabaseServerClient();
  const { data, error } = await client
    .rpc('get_shared_project', {
      p_account_id: company.id,
      p_public_slug: projectSlug,
    })
    .maybeSingle();

  if (error) {
    await logReadFailure('public-project', error, {
      accountId: company.id,
      projectSlug,
    });
    return null;
  }

  return data ? toPublicProject(data, company) : null;
}

/**
 * The company page's list: public projects only. Unlisted ones are not
 * listed anywhere.
 */
export async function getPublicProjects(
  company: PublicAccount,
): Promise<PublicProject[]> {
  const client = getSupabaseServerClient();

  // Paged: an unpaged read stops at the server's row cap with HTTP 200 and
  // no error. `created_at` keeps newest-first; `id` makes pages stable.
  //
  // Failures are logged and degrade to an empty list rather than throwing:
  // the caller renders this inside a public page with a bare await, so a
  // throw would 500 the whole page instead of dropping one section.
  try {
    const rows = await fetchAllRows(
      (from, to) =>
        client
          .from('public_projects')
          .select('*')
          .eq('account_id', company.id)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      'public projects',
    );

    return rows.map((row) => toPublicProject(row, company));
  } catch (error) {
    await logReadFailure(
      'public-projects',
      { message: error instanceof Error ? error.message : String(error) },
      { accountId: company.id },
    );

    return [];
  }
}

/**
 * An episode by its link: public or unlisted, on a project the link could
 * open. An `inherit` episode takes its project's visibility.
 */
export async function getPublicEpisode(
  project: PublicProject,
  episodeSlug: string,
): Promise<PublicEpisode | null> {
  const client = getSupabaseServerClient();
  const { data, error } = await client
    .rpc('get_shared_episode', {
      p_project_id: project.id,
      p_slug: episodeSlug,
    })
    .maybeSingle();

  if (error) {
    await logReadFailure('public-episode', error, {
      projectId: project.id,
      episodeSlug,
    });
    return null;
  }

  return data ? toPublicEpisode(data, project) : null;
}

/**
 * The project page's list: released episodes (at least one localized video)
 * that are public or inherit, on a project opened by its link.
 */
export async function getPublicEpisodes(
  project: PublicProject,
): Promise<PublicEpisode[]> {
  const client = getSupabaseServerClient();

  try {
    const rows = await fetchAllRows(
      (from, to) =>
        client
          .rpc('get_shared_project_episodes', { p_project_id: project.id })
          .not('slug', 'is', null)
          .not('localized_videos', 'is', null)
          .neq('localized_videos', '{}')
          .order('number', { ascending: true })
          .order('id')
          .range(from, to),
      'public episodes',
    );

    return rows.map((row) => toPublicEpisode(row, project));
  } catch (error) {
    await logReadFailure(
      'public-episodes',
      { message: error instanceof Error ? error.message : String(error) },
      { projectId: project.id },
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
 * The platform URLs of an episode, grouped by language, from the episode's
 * own `localized_videos`. Priority for embedding: YouTube > Facebook.
 */
export function getEpisodePlatformUrls(
  episode: Pick<PublicEpisode, 'localized_videos'>,
): EpisodePlatformUrlsByLanguage {
  const urlsByLanguage: Record<string, LanguagePlatformUrls> = {};

  for (const [lang, platforms] of Object.entries(
    episode.localized_videos ?? {},
  )) {
    urlsByLanguage[lang] = {
      youtubeUrl: platforms.youtube?.url ?? null,
      facebookUrl: platforms.facebook?.url ?? null,
    };
  }

  const languages = Object.keys(urlsByLanguage).sort();

  const defaultLanguage = languages.includes('en')
    ? 'en'
    : languages[0] || null;

  return { languages, defaultLanguage, urlsByLanguage };
}

/**
 * Fetch all public data for sitemap generation: public rows only, so an
 * unlisted page never reaches a search engine.
 *
 * Paged rather than capped (PostgREST's `max_rows` is 1000), ordered by the
 * primary key so page boundaries neither skip nor repeat. NULL slugs are
 * filtered in SQL, so a page carries only rows that can produce a URL.
 */
export async function getSitemapData() {
  const client = getSupabaseServerClient();

  const accounts = await fetchAllRows(
    (from, to) =>
      client
        .from('public_accounts')
        .select('slug, updated_at')
        .not('slug', 'is', null)
        .order('id')
        .range(from, to),
    'sitemap accounts',
  );

  const projects = await fetchAllRows(
    (from, to) =>
      client
        .from('public_projects')
        .select('public_slug, account_slug, updated_at')
        .order('id')
        .range(from, to),
    'sitemap projects',
  );

  const episodes = await fetchAllRows(
    (from, to) =>
      client
        .from('public_episodes')
        .select('public_slug, project_public_slug, account_slug, updated_at')
        .not('public_slug', 'is', null)
        .order('id')
        .range(from, to),
    'sitemap episodes',
  );

  return { accounts, projects, episodes };
}
