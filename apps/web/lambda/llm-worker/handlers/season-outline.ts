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
  supabase: SupabaseClient,
): Promise<SeasonOutlineResult> {
  const data = payload as SeasonOutlinePayload;

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
            (c: { name: string; description?: string }) =>
              `- ${c.name}: ${c.description || ''}`,
          )
          .join('\n')
      : 'No characters defined yet.';

  const existingLocations =
    locations.length > 0
      ? locations
          .map(
            (l: { name: string; description?: string }) =>
              `- ${l.name}: ${l.description || ''}`,
          )
          .join('\n')
      : 'No locations defined yet.';

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
