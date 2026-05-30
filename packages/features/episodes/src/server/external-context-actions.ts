/**
 * External Context Server Actions
 * Phase 11: FILM-1135
 *
 * Server actions for searching, listing, and managing external content sources.
 */

'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  getContextAggregator,
  rowToExternalContent,
} from '../lib/server/services/context-aggregator';
import type {
  AggregatorSearchResult,
  ExternalContent,
  SourceCategory,
} from '../types/external-context';
import { SOURCE_CATEGORIES } from '../types/external-context';

/**
 * External Context Server Actions
 * Phase 11: FILM-1135
 *
 * Server actions for searching, listing, and managing external content sources.
 */

/**
 * External Context Server Actions
 * Phase 11: FILM-1135
 *
 * Server actions for searching, listing, and managing external content sources.
 */

/**
 * External Context Server Actions
 * Phase 11: FILM-1135
 *
 * Server actions for searching, listing, and managing external content sources.
 */

// =============================================================================
// SCHEMAS
// =============================================================================

const SearchExternalContentSchema = z.object({
  query: z.string().min(1),
  category: z
    .union([z.enum(SOURCE_CATEGORIES), z.array(z.enum(SOURCE_CATEGORIES))])
    .optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sources: z.array(z.string().uuid()).optional(),
  credibilityTier: z.enum(['tier_1', 'tier_2', 'tier_3']).optional(),
  peerReviewedOnly: z.boolean().optional(),
  language: z.string().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  page: z.number().int().min(1).optional(),
});

const ListSourcesSchema = z.object({
  category: z.enum(SOURCE_CATEGORIES).optional(),
  activeOnly: z.boolean().optional(),
});

// =============================================================================
// SEARCH ACTION
// =============================================================================

/**
 * Search external content across all configured providers.
 */
export const searchExternalContentAction = enhanceAction(
  async (
    data: z.infer<typeof SearchExternalContentSchema>,
  ): Promise<AggregatorSearchResult> => {
    const aggregator = await getContextAggregator();

    return aggregator.search({
      query: data.query,
      category: data.category as SourceCategory | SourceCategory[] | undefined,
      from: data.from ? new Date(data.from) : undefined,
      to: data.to ? new Date(data.to) : undefined,
      sources: data.sources,
      credibilityTier: data.credibilityTier,
      peerReviewedOnly: data.peerReviewedOnly,
      language: data.language,
      pageSize: data.pageSize,
      page: data.page,
    });
  },
  {
    auth: true,
    schema: SearchExternalContentSchema,
  },
);

// =============================================================================
// LIST SOURCES ACTION
// =============================================================================

/**
 * List registered external sources, optionally filtered by category.
 */
export const listExternalSourcesAction = enhanceAction(
  async (data: z.infer<typeof ListSourcesSchema>) => {
    const supabase = getSupabaseServerClient();
    const activeOnly = data.activeOnly ?? true;

    let query = supabase
      .from('external_sources')
      .select(
        'id, name, slug, description, website_url, api_endpoint, category, provider_type, credibility_tier, is_active, created_at, updated_at',
      )
      .order('category')
      .order('name');

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    if (data.category) {
      query = query.eq('category', data.category);
    }

    const { data: sources, error } = await query;

    if (error) {
      console.error(
        '[external-context] Failed to list sources:',
        error.message,
      );
      throw new Error(`Failed to list sources: ${error.message}`);
    }

    return sources ?? [];
  },
  {
    auth: true,
    schema: ListSourcesSchema,
  },
);

// =============================================================================
// GET AVAILABLE PROVIDERS ACTION
// =============================================================================

/**
 * Get available (configured + not rate-limited) providers per category.
 */
export const getAvailableProvidersAction = enhanceAction(
  async () => {
    const aggregator = await getContextAggregator();

    const categories = SOURCE_CATEGORIES;

    const result: Record<string, string[]> = {};
    for (const cat of categories) {
      const providers = aggregator.getProvidersForCategory(cat);
      if (providers.length > 0) {
        result[cat] = providers;
      }
    }

    return {
      providers: result,
      registered: aggregator.getRegisteredProviders(),
    };
  },
  {
    auth: true,
    schema: z.object({}),
  },
);

// =============================================================================
// GET CONTENT BY ID ACTION
// =============================================================================

const GetContentByIdSchema = z.object({
  contentId: z.string().uuid(),
});

/**
 * Get a single cached external content item by ID.
 */
export const getExternalContentByIdAction = enhanceAction(
  async (
    data: z.infer<typeof GetContentByIdSchema>,
  ): Promise<ExternalContent | null> => {
    const supabase = getSupabaseServerClient();

    const { data: rawRow, error } = await supabase
      .from('external_content')
      .select(
        'id, external_id, source_id, title, description, content, url, authors, published_at, language, category, topics, entities, doi, journal, citations, peer_reviewed, image_url, credibility_tier, bias_label, fetched_at, cache_expires_at',
      )
      .eq('id', data.contentId)
      .single();

    if (error || !rawRow) return null;

    return rowToExternalContent(rawRow);
  },
  {
    auth: true,
    schema: GetContentByIdSchema,
  },
);

// =============================================================================
// SOURCE CRUD ACTIONS (FILM-1140)
// =============================================================================

const AddSourceSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100),
  description: z.string().optional(),
  websiteUrl: z.string().url().optional(),
  apiEndpoint: z.string().url().optional(),
  category: z.enum(SOURCE_CATEGORIES),
  providerType: z.string().min(1).max(50),
  credibilityTier: z.enum(['tier_1', 'tier_2', 'tier_3']).optional(),
});

/**
 * Verify the authenticated user is an owner of at least one account.
 * Only account owners can modify the global source registry.
 * This follows the same pattern as account_oauth_apps RLS policies.
 */
async function requireAccountOwner() {
  const supabase = getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Authentication required');
  }

  const { count } = await supabase
    .from('accounts_memberships')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('account_role', 'owner');

  if (!count || count === 0) {
    throw new Error('Only account owners can manage global sources');
  }

  return user;
}

/**
 * Add a new external source to the registry.
 * Uses admin client since RLS only allows service_role writes.
 * Requires account membership for authorization.
 */
export const addExternalSourceAction = enhanceAction(
  async (data: z.infer<typeof AddSourceSchema>) => {
    await requireAccountOwner();
    const supabase = getSupabaseServerAdminClient();

    const { data: source, error } = await supabase
      .from('external_sources')
      .insert({
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        website_url: data.websiteUrl ?? null,
        api_endpoint: data.apiEndpoint ?? null,
        category: data.category,
        provider_type: data.providerType,
        credibility_tier: data.credibilityTier ?? 'tier_3',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to add source: ${error.message}`);
    }

    return { source };
  },
  {
    auth: true,
    schema: AddSourceSchema,
  },
);

const UpdateSourceSchema = z.object({
  sourceId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  websiteUrl: z.string().url().optional(),
  credibilityTier: z.enum(['tier_1', 'tier_2', 'tier_3']).optional(),
  isActive: z.boolean().optional(),
});

/**
 * Update an existing external source.
 * Requires account membership for authorization.
 */
export const updateExternalSourceAction = enhanceAction(
  async (data: z.infer<typeof UpdateSourceSchema>) => {
    await requireAccountOwner();
    const supabase = getSupabaseServerAdminClient();

    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.websiteUrl !== undefined) updates.website_url = data.websiteUrl;
    if (data.credibilityTier !== undefined)
      updates.credibility_tier = data.credibilityTier;
    if (data.isActive !== undefined) updates.is_active = data.isActive;

    const { error } = await supabase
      .from('external_sources')
      .update(updates)
      .eq('id', data.sourceId);

    if (error) {
      throw new Error(`Failed to update source: ${error.message}`);
    }

    return { success: true };
  },
  {
    auth: true,
    schema: UpdateSourceSchema,
  },
);

const DeleteSourceSchema = z.object({
  sourceId: z.string().uuid(),
});

/**
 * Soft-delete a source by setting is_active = false.
 * Requires account membership for authorization.
 */
export const deleteExternalSourceAction = enhanceAction(
  async (data: z.infer<typeof DeleteSourceSchema>) => {
    await requireAccountOwner();
    const supabase = getSupabaseServerAdminClient();

    const { error } = await supabase
      .from('external_sources')
      .update({ is_active: false })
      .eq('id', data.sourceId);

    if (error) {
      throw new Error(`Failed to delete source: ${error.message}`);
    }

    return { success: true };
  },
  {
    auth: true,
    schema: DeleteSourceSchema,
  },
);

/**
 * Get counts of sources and facts for sidebar badge.
 *
 * NOTE: `external_sources` is intentionally global (not project-scoped).
 * Sources represent shared reference data (e.g., Reuters, Wikipedia) so
 * `sources` and `apiSources` counts reflect all active sources across the
 * platform. Only `facts` is filtered by project.
 */
export const getResearchCountsAction = enhanceAction(
  async (data: { projectId: string }) => {
    const supabase = getSupabaseServerClient();

    const [sourcesResult, factsResult, apiSourcesResult] = await Promise.all([
      supabase
        .from('external_sources')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true),
      supabase
        .from('verified_facts')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', data.projectId),
      supabase
        .from('external_sources')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .in('provider_type', ['newsapi', 'semantic_scholar', 'custom_api']),
    ]);

    return {
      sources: sourcesResult.count ?? 0,
      facts: factsResult.count ?? 0,
      apiSources: apiSourcesResult.count ?? 0,
    };
  },
  {
    auth: true,
    schema: z.object({ projectId: z.string().uuid() }),
  },
);

/**
 * Get verified facts for a project (for passing to season generation)
 */
export const getVerifiedFactsAction = enhanceAction(
  async (data: { projectId: string; limit?: number }) => {
    const supabase = getSupabaseServerClient();

    const query = supabase
      .from('verified_facts')
      .select(
        'id, claim, source_citation, category, verification_status, source_type',
      )
      .eq('project_id', data.projectId)
      .eq('verification_status', 'verified')
      .order('created_at', { ascending: false });

    if (data.limit) {
      query.limit(data.limit);
    } else {
      query.limit(200);
    }

    const { data: facts, error } = await query;

    if (error) {
      throw new Error('Failed to fetch verified facts');
    }

    return facts ?? [];
  },
  {
    auth: true,
    schema: z.object({
      projectId: z.string().uuid(),
      limit: z.number().int().positive().optional(),
    }),
  },
);
