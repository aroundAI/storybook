/**
 * Season Outline Handler
 *
 * Generates episode outlines for a season.
 * No database writes - returns outlines to frontend for preview.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

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
    };
  };
}

export async function processSeasonOutline(
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<SeasonOutlineResult> {
  const data = payload as SeasonOutlinePayload;

  console.log(`[Season Outline] Generating ${data.episodeCount} episodes`);

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

  // Build prompt variables
  const variables = {
    season_premise: data.seasonPremise,
    episode_count: data.episodeCount,
    starting_number: data.startingNumber,
    genre: data.genre || projectMetadata.genre || 'general',
    style: data.style || 'cinematic',
    existing_characters:
      characters.length > 0
        ? characters
            .map((c) => `- ${c.name}: ${c.description || ''}`)
            .join('\n')
        : 'No characters defined yet.',
    existing_locations:
      locations.length > 0
        ? locations.map((l) => `- ${l.name}: ${l.description || ''}`).join('\n')
        : 'No locations defined yet.',
    recurring_element: recurringElementFormatted,
  };

  // Execute LLM
  const { executeLLM } = await import('@kit/prompt-engine/server');

  const result = await executeLLM<{ episodes: EpisodeOutline[] }>({
    templateSlug: 'season-outline',
    variables,
    context: {
      name: 'season-outline',
      accountId: data.accountId,
      userId: data.userId,
    },
    supabaseClient: supabase,
  });

  const costCents = Math.ceil((result.metadata.cost ?? 0) * 100);
  const generatedAt = new Date().toISOString();

  console.log(
    `[Season Outline] Generated ${result.data.episodes.length} outlines`,
  );

  return {
    success: true,
    data: {
      episodes: result.data.episodes,
      metadata: {
        provider: result.metadata.provider,
        model: result.metadata.model,
        costCents,
        tokensUsed: result.metadata.tokens,
        generatedAt,
      },
    },
  };
}
