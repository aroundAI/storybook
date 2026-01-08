import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Database } from '@kit/supabase/database';

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
        .select(`
      *,
      account:accounts!inner(id, name, slug)
    `)
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
export async function getPublicProjects(accountId: string): Promise<PublicProject[]> {
    const client = getSupabaseServerClient();
    const { data, error } = await client
        .from('projects')
        .select(`
      *,
      account:accounts!inner(id, name, slug)
    `)
        .eq('account_id', accountId)
        .eq('visibility', 'public')
        .order('created_at', { ascending: false });

    if (error) return [];
    return data as unknown as PublicProject[];
}

/**
 * Get a public episode by project ID and episode slug.
 * accessible if visibility is 'public' OR 'unlisted' (or 'inherit' if project is accessible).
 */
export async function getPublicEpisode(projectId: string, episodeSlug: string): Promise<PublicEpisode | null> {
    const client = getSupabaseServerClient();

    // First fetch the episode to check its visibility
    const { data: episode, error } = await client
        .from('episodes')
        .select(`
      *,
      project:projects!inner(
        id,
        name,
        public_slug,
        visibility,
        account:accounts!inner(id, name, slug)
      )
    `)
        .eq('project_id', projectId)
        .eq('public_slug', episodeSlug)
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
 * Grouping by season is usually done in UI or via a transform, here we return flat list.
 */
export async function getPublicEpisodes(projectId: string): Promise<PublicEpisode[]> {
    const client = getSupabaseServerClient();
    const { data, error } = await client
        .from('episodes')
        .select(`
      *,
      project:projects!inner(
        id,
        name,
        public_slug,
        visibility,
        account:accounts!inner(id, name, slug)
      )
    `)
        .eq('project_id', projectId)
        // Allow 'public' AND 'inherit' (exclude 'unlisted' and 'private')
        .in('visibility', ['public', 'inherit'])
        .order('number', { ascending: true });

    if (error) return [];
    return data as unknown as PublicEpisode[];
}

/**
 * Fetch all public data for sitemap generation.
 */
export async function getSitemapData() {
    const client = getSupabaseServerClient();

    // 1. Public Accounts (Companies)
    const { data: accounts } = await client
        .from('accounts')
        .select('slug, updated_at')
        .eq('public_profile->>is_public', 'true')
        .limit(1000);

    // 2. Public Projects
    const { data: projects } = await client
        .from('projects')
        .select(`
        public_slug, 
        updated_at,
        account:accounts!inner(slug)
      `)
        .eq('visibility', 'public')
        .limit(2000);

    // 3. Public Episodes
    const { data: episodes } = await client
        .from('episodes')
        .select(`
        public_slug, 
        updated_at,
        project:projects!inner(
          public_slug,
          account:accounts!inner(slug)
        )
      `)
        .in('visibility', ['public', 'inherit'])
        .limit(5000);

    return {
        accounts: accounts || [],
        projects: projects || [],
        episodes: episodes || [],
    };
}
