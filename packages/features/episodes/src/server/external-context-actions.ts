'use server';

/**
 * External Context Server Actions
 * Phase 11: FILM-1135
 *
 * Server actions for searching, listing, and managing external content sources.
 */
import { z } from 'zod';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import type { Database } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  PROJECT_SOURCE_REFUSAL,
  SOURCE_EXISTS_REFUSAL,
  SOURCE_REMOVE_REFUSAL,
  TEAM_SOURCE_REFUSAL,
} from '../lib/research-source-refusals';
import { canWriteProject } from '../lib/server/project-write-access';
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
  /** Built-ins plus this project's team's and this project's own; built-ins only when absent. */
  projectId: z.string().uuid().optional(),
});

type ServerClient = ReturnType<typeof getSupabaseServerClient<Database>>;

/** Who a source belongs to (KB-37). */
export type SourceKind = 'builtin' | 'team' | 'project';

/** The team a project belongs to, as the caller sees it (RLS). */
async function projectTeam(client: ServerClient, projectId: string) {
  const { data, error } = await client
    .from('projects')
    .select('account_id')
    .eq('id', projectId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read the project: ${error.message}`);
  }

  return data?.account_id ?? null;
}

/**
 * PostgREST filter for the sources a project's hub shows: built-ins, the
 * project's team's own, and the project's own (KB-26, KB-37). RLS already
 * hides other teams' and projects' rows; this also keeps the caller's other
 * teams and projects out of this project's hub.
 */
function hubSources(projectId: string | undefined, teamId: string | null) {
  if (!projectId) return 'is_builtin.eq.true';

  const team = teamId ? `,and(project_id.is.null,account_id.eq.${teamId})` : '';

  return `is_builtin.eq.true,project_id.eq.${projectId}${team}`;
}

async function isTeamOwner(client: ServerClient, teamId: string) {
  const { data, error } = await client.rpc('has_role_on_account', {
    account_id: teamId,
    account_role: 'owner',
  });

  if (error) {
    throw new Error(`has_role_on_account failed: ${error.message}`);
  }

  return data === true;
}

function sourceKind(row: {
  is_builtin: boolean;
  project_id: string | null;
}): SourceKind {
  if (row.is_builtin) return 'builtin';
  return row.project_id ? 'project' : 'team';
}

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
 * List the sources a project's hub shows, optionally filtered by category.
 * Each row says whose it is (`kind`) and whether the caller may remove it
 * (`canRemove`), by the same rules as RLS (KB-37).
 */
export const listExternalSourcesAction = enhanceAction(
  async (data: z.infer<typeof ListSourcesSchema>) => {
    const supabase = getSupabaseServerClient();
    const activeOnly = data.activeOnly ?? true;
    const teamId = data.projectId
      ? await projectTeam(supabase, data.projectId)
      : null;

    let query = supabase
      .from('external_sources')
      .select(
        'id, name, slug, description, website_url, api_endpoint, category, provider_type, credibility_tier, is_active, is_builtin, account_id, project_id, created_at, updated_at',
      )
      .or(hubSources(data.projectId, teamId))
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

    const [mayWriteProject, ownsTeam] = await Promise.all([
      data.projectId ? canWriteProject(supabase, data.projectId) : false,
      teamId ? isTeamOwner(supabase, teamId) : false,
    ]);

    return (sources ?? []).map((row) => {
      const kind = sourceKind(row);

      return {
        ...row,
        kind,
        canRemove:
          (kind === 'project' && mayWriteProject) ||
          (kind === 'team' && ownsTeam),
      };
    });
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
// SOURCE ACTIONS (FILM-1140; KB-37)
// =============================================================================
//
// Sources belong to a team (KB-37): a team source is managed by the team's
// owners, a project source by the project's writers, and built-ins only by
// migrations. Every write goes through the caller's own client, so RLS on
// `external_sources` is the rule; the checks here only say why, as a value.

const AddSourceSchema = z.object({
  /** The project whose hub the source is added from. */
  projectId: z.string().uuid(),
  /** This project only, or every project of the project's team. */
  scope: z.enum(['project', 'team']),
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100),
  description: z.string().optional(),
  websiteUrl: z.string().url().optional(),
  apiEndpoint: z.string().url().optional(),
  category: z.enum(SOURCE_CATEGORIES),
  providerType: z.string().min(1).max(50),
  credibilityTier: z.enum(['tier_1', 'tier_2', 'tier_3']).optional(),
});

/** Postgres error codes these actions turn into refusals. */
const UNIQUE_VIOLATION = '23505';
const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * Add a source to a project, or to the project's team. RLS refuses anyone
 * else; the checks first say why.
 */
const addExternalSource = enhanceAction(
  async (data: z.infer<typeof AddSourceSchema>) => {
    const supabase = getSupabaseServerClient();

    let owner: { project_id: string } | { account_id: string };

    if (data.scope === 'project') {
      if (!(await canWriteProject(supabase, data.projectId))) {
        throw new ActionRefusal(PROJECT_SOURCE_REFUSAL);
      }
      owner = { project_id: data.projectId };
    } else {
      const teamId = await projectTeam(supabase, data.projectId);

      if (!teamId || !(await isTeamOwner(supabase, teamId))) {
        throw new ActionRefusal(TEAM_SOURCE_REFUSAL);
      }
      owner = { account_id: teamId };
    }

    const { data: source, error } = await supabase
      .from('external_sources')
      .insert({
        ...owner,
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

    if (error?.code === UNIQUE_VIOLATION) {
      throw new ActionRefusal(SOURCE_EXISTS_REFUSAL);
    }

    if (error?.code === INSUFFICIENT_PRIVILEGE) {
      throw new ActionRefusal(
        data.scope === 'team' ? TEAM_SOURCE_REFUSAL : PROJECT_SOURCE_REFUSAL,
      );
    }

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

export const addExternalSourceAction = returnRefusals(addExternalSource);

const DeleteSourceSchema = z.object({
  sourceId: z.string().uuid(),
});

/**
 * Deactivate a source (`is_active = false`). RLS matches only a source the
 * caller may change: their team's (as an owner) or their project's (as a
 * writer). A built-in, another team's source or a guessed id matches no row,
 * and that is the refusal.
 */
const deleteExternalSource = enhanceAction(
  async (data: z.infer<typeof DeleteSourceSchema>) => {
    const supabase = getSupabaseServerClient();

    const { data: rows, error } = await supabase
      .from('external_sources')
      .update({ is_active: false })
      .eq('id', data.sourceId)
      .eq('is_builtin', false)
      .select('id');

    if (error?.code === INSUFFICIENT_PRIVILEGE) {
      throw new ActionRefusal(SOURCE_REMOVE_REFUSAL);
    }

    if (error) {
      throw new Error(`Failed to remove source: ${error.message}`);
    }

    if (!rows?.length) {
      throw new ActionRefusal(SOURCE_REMOVE_REFUSAL);
    }

    return { success: true };
  },
  {
    auth: true,
    schema: DeleteSourceSchema,
  },
);

export const deleteExternalSourceAction = returnRefusals(deleteExternalSource);

/**
 * Get counts of sources and facts for sidebar badge.
 *
 * `sources` counts what the project's hub lists: built-ins, the team's own
 * and the project's own (KB-26, KB-37). `apiSources` counts the built-in
 * provider sources, the only ones the aggregator searches. `facts` is
 * filtered by project.
 */
export const getResearchCountsAction = enhanceAction(
  async (data: { projectId: string }) => {
    const supabase = getSupabaseServerClient();
    const teamId = await projectTeam(supabase, data.projectId);

    const [sourcesResult, factsResult, apiSourcesResult] = await Promise.all([
      supabase
        .from('external_sources')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .or(hubSources(data.projectId, teamId)),
      supabase
        .from('verified_facts')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', data.projectId),
      supabase
        .from('external_sources')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .eq('is_builtin', true)
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
