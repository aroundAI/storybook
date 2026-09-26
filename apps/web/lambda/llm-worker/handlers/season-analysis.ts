/**
 * Season Analysis Handler
 *
 * Processes roadmap analysis LLM calls for season generation.
 * Extracts premise, characters, locations, and episodes from user's roadmap.
 * When verified facts are provided, assigns them to specific episodes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { sanitizeForPrompt, sanitizeStrings } from '@kit/episodes/lib';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import { executeLLMForLambda } from '../llm-utils';

interface EpisodeBeat {
  label: string;
  content: string;
}

interface ExtractedEpisode {
  number: number;
  title: string;
  synopsis: string;
  beats: EpisodeBeat[];
  moral?: string | null;
  signature_line?: string | null;
  character_names?: string[];
  location_names?: string[];
  characterNames?: string[];
  locationNames?: string[];
  tags?: string[];
  fact_ids?: string[];
  description?: string; // Legacy support
}

interface AnalysisResult {
  premise: string;
  tone?: string | null;
  target_audience?: string | null;
  characters: Array<{
    name: string;
    role: string;
    description: string;
    physicalDescription?: string;
    clothingStyle?: string;
    mannerisms?: string;
  }>;
  locations: Array<{
    name: string;
    setting: string;
    description: string;
    visualDescription?: string;
    timeOfDay?: string | null;
    weather?: string | null;
  }>;
  episodes: ExtractedEpisode[];
}

interface ExternalFact {
  id?: string;
  claim: string;
  source_citation?: string | null;
  category?: string | null;
}

/**
 * Format verified facts into a prompt-injectable string for season planning.
 * Each fact gets an ID so the LLM can reference it in episode assignments.
 */
function formatFactsForSeasonPrompt(facts: ExternalFact[]): string {
  if (facts.length === 0) return '';

  const factLines = facts
    .map((f, i) => {
      const id = f.id ?? `fact-${i + 1}`;
      const source = f.source_citation ? ` | Source: ${f.source_citation}` : '';
      const category = f.category ? ` | Category: ${f.category}` : '';
      return `FACT [${id}]: ${f.claim}${source}${category}`;
    })
    .join('\n');

  return `## VERIFIED FACTS — assign each to an episode\n\n${factLines}\n\nTotal: ${facts.length} facts. Every fact MUST appear in at least one episode's fact_ids array.`;
}

/**
 * Process season analysis LLM call
 * This is the same logic as analyzeSeasonRoadmapAction, but runs in Lambda
 */
export async function processSeasonAnalysis(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<{ success: boolean; data: AnalysisResult }> {
  const { projectId, roadmap, externalFacts } = parseLlmJobPayload(
    'season-analysis',
    payload,
  );

  console.log(
    `[Season Analysis] Processing for project ${projectId}, facts: ${externalFacts?.length ?? 0}`,
  );

  // Format facts for the prompt if provided
  const verifiedFacts =
    externalFacts && externalFacts.length > 0
      ? formatFactsForSeasonPrompt(sanitizeStrings(externalFacts))
      : '';

  // The project's recurring elements: the template has a place for them,
  // and nothing filled it (KB-126)
  const { data: project } = await supabase
    .from('projects')
    .select('metadata')
    .eq('id', projectId)
    .single();
  // Read for the model only: defused here, as season-outline does (KB-101)
  const projectMetadata = sanitizeStrings(
    (project?.metadata as Record<string, unknown>) || {},
  );
  const { formatRecurringElementsForPrompt } = await import(
    '../utils/context-builder'
  );
  const recurringElement = formatRecurringElementsForPrompt(
    Array.isArray(projectMetadata.recurringElements)
      ? projectMetadata.recurringElements
      : [],
  );

  // Use Lambda-safe LLM executor
  const { data: result } = await executeLLMForLambda<AnalysisResult>({
    templateSlug: 'season-generation',
    variables: {
      // The user's roadmap and facts, defused for the model (KB-101)
      roadmap: sanitizeForPrompt(roadmap),
      verified_facts: verifiedFacts,
      recurring_element: recurringElement,
    },
  });

  // Validate required fields
  if (!result.episodes || !Array.isArray(result.episodes)) {
    throw new Error('Invalid response format: missing episodes array');
  }

  if (!result.premise || typeof result.premise !== 'string') {
    result.premise = 'Generated from roadmap';
  }

  if (!result.characters || !Array.isArray(result.characters)) {
    result.characters = [];
  }

  if (!result.locations || !Array.isArray(result.locations)) {
    result.locations = [];
  }

  console.log('[Season Analysis] Success:', {
    episodeCount: result.episodes.length,
    characterCount: result.characters.length,
    locationCount: result.locations.length,
    factsAssigned: result.episodes.reduce(
      (sum, ep) => sum + (ep.fact_ids?.length ?? 0),
      0,
    ),
  });

  return { success: true, data: result };
}
