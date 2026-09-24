/**
 * Season Outline Handler
 *
 * Generates episode outlines for a season.
 * Uses the Season Orchestrator for quality-gated outline generation:
 *   generateSeasonOutline → evaluateSeasonArc → revise weak episodes (max 1 cycle)
 *
 * No database writes — returns outlines to frontend for preview via WebSocket.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

/** Facts offered to one outline; the prompt asks for every one to be placed. */
const MAX_OUTLINE_FACTS = 100;

interface SeasonOutlinePayload {
  projectId: string;
  seasonId?: string;
  seasonPremise: string;
  episodeCount: number;
  startingNumber: number;
  genre?: string;
  style?: string;
  accountId: string;
  userId: string;
}

interface EpisodeOutline {
  number: number;
  title: string;
  synopsis: string;
  beats: Array<{ label: string; content: string }>;
  moral?: string;
  signatureLine?: string;
  characterNames?: string[];
  locationNames?: string[];
  tags?: string[];
}

interface SeasonOutlineResult {
  success: boolean;
  data: {
    episodes: EpisodeOutline[];
    metadata: {
      provider: string;
      model: string;
      costCents: number;
      tokensUsed: number;
      generatedAt: string;
      orchestratorSteps?: number;
      arcScore?: number;
      arcSummary?: string;
    };
  };
}

export async function processSeasonOutline(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<SeasonOutlineResult> {
  // SQS payload: cast, not validated (KB-33).
  const data = payload as unknown as SeasonOutlinePayload;

  console.log(
    `[Season Outline] Starting AGENTIC pipeline for ${data.episodeCount} episodes`,
  );

  // Fetch project context
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, metadata')
    .eq('id', data.projectId)
    .single();

  const projectMetadata = (project?.metadata as Record<string, unknown>) || {};

  // Extract recurring elements from project metadata
  const recurringElements = Array.isArray(projectMetadata.recurringElements)
    ? projectMetadata.recurringElements
    : [];
  const { formatRecurringElementsForPrompt } = await import(
    '../utils/context-builder'
  );
  const recurringElementFormatted =
    formatRecurringElementsForPrompt(recurringElements);

  // Fetch existing characters and locations
  const [charactersResult, locationsResult] = await Promise.all([
    supabase
      .from('assets')
      .select('name, description, metadata')
      .eq('project_id', data.projectId)
      .eq('type', 'character')
      .is('deleted_at', null)
      .limit(10),
    supabase
      .from('assets')
      .select('name, description')
      .eq('project_id', data.projectId)
      .eq('type', 'location')
      .is('deleted_at', null)
      .limit(10),
  ]);

  const characters = charactersResult.data || [];
  const locations = locationsResult.data || [];

  const existingCharacters =
    characters.length > 0
      ? characters
          .map(
            (c) =>
              `- ${c.name}: ${c.description || ''}`,
          )
          .join('\n')
      : 'No characters defined yet.';

  const existingLocations =
    locations.length > 0
      ? locations
          .map(
            (l) =>
              `- ${l.name}: ${l.description || ''}`,
          )
          .join('\n')
      : 'No locations defined yet.';

  // KB-71: the type is `metadata.projectType`, read the one way every other
  // reader does. Only `verified` facts go in (owner decision, 2026-09-24).
  const { getContentTypeConfig, resolveProjectType, sanitizeForPrompt } =
    await import('@kit/episodes/lib');
  const { projectType } = resolveProjectType(project?.metadata);
  let verifiedFactsFormatted = '';

  if (getContentTypeConfig(projectType).requiresFacts) {
    const [{ data: factsData, error: factsError }, { count: verifiedCount }] =
      await Promise.all([
        supabase
          .from('verified_facts')
          .select('id, claim, source_citation, category')
          .eq('project_id', data.projectId)
          .eq('verification_status', 'verified')
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(MAX_OUTLINE_FACTS),
        supabase
          .from('verified_facts')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', data.projectId)
          .eq('verification_status', 'verified'),
      ]);

    if (factsError) {
      console.error(
        '[Season Outline] Failed to fetch verified facts:',
        factsError,
      );
    }

    const facts = factsData ?? [];

    if (facts.length > 0) {
      const factLines = facts
        .map((f) => {
          const source = f.source_citation
            ? ` | Source: ${sanitizeForPrompt(f.source_citation)}`
            : '';
          const category = f.category
            ? ` | Category: ${sanitizeForPrompt(f.category)}`
            : '';
          return `FACT [${f.id}]: ${sanitizeForPrompt(f.claim)}${source}${category}`;
        })
        .join('\n');

      verifiedFactsFormatted = `## VERIFIED FACTS — assign each to an episode\n\n${factLines}\n\nTotal: ${facts.length} facts. Every fact MUST appear in at least one episode's fact_ids array.`;
    }

    console.log(
      `[Season Outline] projectType=${projectType} loaded=${facts.length} verified=${verifiedCount ?? 'unknown'}` +
        ((verifiedCount ?? 0) > facts.length
          ? ` (truncated to ${MAX_OUTLINE_FACTS})`
          : ''),
    );
  }

  // Run the Season Orchestrator
  const { runSeasonOrchestrator } = await import(
    '@kit/episodes/agent/season-orchestrator'
  );

  const orchestratorResult = await runSeasonOrchestrator({
    projectId: data.projectId,
    seasonPremise: data.seasonPremise,
    episodeCount: data.episodeCount,
    startingNumber: data.startingNumber,
    genre: data.genre || (projectMetadata.genre as string) || 'general',
    style: data.style || 'cinematic',
    accountId: data.accountId,
    existingCharacters,
    existingLocations,
    recurringElements: recurringElementFormatted,
    verifiedFacts: verifiedFactsFormatted || undefined,
  });

  if (!orchestratorResult.success) {
    throw new Error(
      `Season Orchestrator failed: ${orchestratorResult.error ?? 'Unknown error'}`,
    );
  }

  const generatedAt = new Date().toISOString();

  console.log(
    `[Season Outline] Agentic pipeline complete. Steps: ${orchestratorResult.orchestratorSteps}, ` +
      `Episodes: ${orchestratorResult.episodes.length}, Arc score: ${orchestratorResult.arcScore?.toFixed(2) ?? 'N/A'}`,
  );

  return {
    success: true,
    data: {
      episodes: orchestratorResult.episodes,
      metadata: {
        provider: 'orchestrator',
        model: 'multi-agent',
        costCents: 0,
        tokensUsed: 0,
        generatedAt,
        orchestratorSteps: orchestratorResult.orchestratorSteps,
        arcScore: orchestratorResult.arcScore,
        arcSummary: orchestratorResult.arcSummary,
      },
    },
  };
}
