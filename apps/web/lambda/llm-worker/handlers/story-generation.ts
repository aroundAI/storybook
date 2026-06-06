/**
 * Story Generation Handler — Stage 1
 *
 * Stage 1 of the 3-stage agentic content pipeline.
 * Runs the Story Orchestrator: Story Director → Viral Analyst → Continuity Guardian.
 * The orchestrator handles the story quality revision loop and stops once
 * story quality is acceptable.
 *
 * After this handler:
 *   - story_data + viral_quality written to DB
 *   - episode status → 'story'
 *   - Stage 2 (screenplay-conversion) triggered by user action on the Story tab
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { commitStoryCanon } from '../utils/commit-story-canon';
import {
  buildEpisodeContext,
  formatCharactersForPrompt,
  formatFactsForPrompt,
  formatLocationsForPrompt,
  formatPreviousEpisodesForPrompt,
  formatRecurringElementsForPrompt,
  formatVerifiedFactsForPrompt,
} from '../utils/context-builder';
import {
  type ContentStyle,
  calculateContentScaling,
} from '../utils/duration-scaling';
import {
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
} from '../utils/job-tracking';

interface NewCharacter {
  name: string;
  role: string;
  arc?: string;
  description: string;
  physicalDescription: string;
  clothingStyle?: string;
  mannerisms?: string;
}

interface NewLocation {
  name: string;
  setting?: string;
  description: string;
  visualDescription?: string;
}

/**
 * Auto-create character and location assets from LLM-invented entities.
 * Uses upsert semantics (ON CONFLICT DO NOTHING) to avoid duplicates.
 * Tags newly created asset IDs onto the episode's metadata.
 */
async function autoCreateNewAssets(
  supabase: SupabaseClient,
  projectId: string,
  episodeId: string,
  newCharacters: NewCharacter[],
  newLocations: NewLocation[],
): Promise<void> {
  if (newCharacters.length === 0 && newLocations.length === 0) return;

  const createdIds: string[] = [];

  // Create character assets
  if (newCharacters.length > 0) {
    const charRows = newCharacters.map((char) => ({
      project_id: projectId,
      type: 'character' as const,
      name: char.name,
      description: char.description,
      metadata: {
        role: char.role,
        personality: char.description,
        physicalAttributes: char.physicalDescription
          ? { rawDescription: char.physicalDescription }
          : undefined,
        clothingStyle: char.clothingStyle
          ? { rawDescription: char.clothingStyle }
          : undefined,
        mannerisms: char.mannerisms,
        autoCreated: true,
      },
    }));

    const { data: inserted } = await supabase
      .from('assets')
      .upsert(charRows, {
        onConflict: 'project_id,type,name',
        ignoreDuplicates: true,
      })
      .select('id');

    if (inserted) {
      createdIds.push(...inserted.map((r: { id: string }) => r.id));
      console.log(
        `[Story Generation] Auto-created ${inserted.length} character assets`,
      );
    }
  }

  // Create location assets
  if (newLocations.length > 0) {
    const locRows = newLocations.map((loc) => ({
      project_id: projectId,
      type: 'location' as const,
      name: loc.name,
      description: loc.description,
      metadata: {
        setting: loc.setting,
        visualDescription: loc.visualDescription,
        autoCreated: true,
      },
    }));

    const { data: inserted } = await supabase
      .from('assets')
      .upsert(locRows, {
        onConflict: 'project_id,type,name',
        ignoreDuplicates: true,
      })
      .select('id');

    if (inserted) {
      createdIds.push(...inserted.map((r: { id: string }) => r.id));
      console.log(
        `[Story Generation] Auto-created ${inserted.length} location assets`,
      );
    }
  }

  // Tag new asset IDs onto episode metadata
  if (createdIds.length > 0) {
    const { data: episode } = await supabase
      .from('episodes')
      .select('metadata')
      .eq('id', episodeId)
      .single();

    if (episode) {
      const metadata = (episode.metadata ?? {}) as Record<string, unknown>;
      const existingCharIds = (metadata.character_ids ?? []) as string[];
      const existingLocIds = (metadata.location_ids ?? []) as string[];

      // Merge without duplicates
      const allIds = [
        ...new Set([...existingCharIds, ...existingLocIds, ...createdIds]),
      ];

      await supabase
        .from('episodes')
        .update({
          metadata: {
            ...metadata,
            character_ids: allIds.filter((id) =>
              [
                ...existingCharIds,
                ...createdIds.slice(0, newCharacters.length),
              ].includes(id),
            ),
            location_ids: allIds.filter((id) =>
              [
                ...existingLocIds,
                ...createdIds.slice(newCharacters.length),
              ].includes(id),
            ),
          },
        })
        .eq('id', episodeId);
    }
  }
}

interface StoryGenerationPayload {
  episodeId: string;
  title: string;
  logline: string;
  targetDuration: number;
  contentStyle: string;
  style?: string;
  version: number;
  accountId: string;
  userId: string;
  projectId: string;
  threadCandidates?: Array<{
    threadId: string;
    threadName: string;
    action: 'progress' | 'resolve';
  }>;
  themes?: string[];
  hook?: string;
  visualDirection?: string;
}

interface StoryOutput {
  fullText: string;
  title: string;
  actBreakdown: Array<{ act: number; summary: string }>;
  characters: string[];
  themes: string[];
  tone: string;
  estimatedSceneCount: number;
  episodeSummary?: string;
  sentimentScore?: number;
  keyEvents?: string[];
}

interface StoryGenerationResult {
  success: boolean;
  data: {
    story: StoryOutput;
    episode: {
      id: string;
      status: string;
      version: number;
    };
    metadata: {
      provider: string;
      model: string;
      costCents: number;
      tokensUsed: number;
      generatedAt: string;
      orchestratorSteps?: number;
    };
  };
}

export async function processStoryGeneration(
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<StoryGenerationResult> {
  const data = payload as StoryGenerationPayload;

  console.log(
    `[Story Generation] Starting AGENTIC pipeline for episode ${data.episodeId}`,
  );

  // Mark job as processing
  await markJobProcessing(supabase, data.episodeId, 'story');

  try {
    // 1. Build rich context using shared context-builder
    const episodeContext = await buildEpisodeContext(data.episodeId, supabase);

    const contentStyle = (data.contentStyle ??
      'dialogue-heavy') as ContentStyle;
    const scaling = calculateContentScaling({
      targetDurationSeconds: data.targetDuration,
      contentStyle,
    });

    // 2. Pre-format Stage 1 context blocks (story/viral/continuity only)
    const charactersContext = formatCharactersForPrompt(
      episodeContext.characters,
    );
    const locationsContext = formatLocationsForPrompt(episodeContext.locations);
    const previousEpisodesContext = formatPreviousEpisodesForPrompt(
      episodeContext.previousEpisodes,
    );
    const seasonContext = episodeContext.seasonPremise
      ? `This is Episode ${episodeContext.episodeNumber}${episodeContext.seasonNumber ? ` of Season ${episodeContext.seasonNumber}` : ''}. Season Premise: ${episodeContext.seasonPremise}`
      : '';
    // Recurring elements — supports multiple recurring story elements
    const recurringElementContext = episodeContext.recurringElements
      ? formatRecurringElementsForPrompt(episodeContext.recurringElements)
      : undefined;

    // Format linked verified facts for fact-driven content
    const factsContext = formatFactsForPrompt(episodeContext.episodeFacts);

    console.log(
      `[Story Generation] Context built: ${episodeContext.characters.length} characters, ${episodeContext.locations.length} locations` +
        (recurringElementContext ? ', recurring element: yes' : '') +
        (episodeContext.projectType ? `, type: ${episodeContext.projectType}` : '') +
        (factsContext ? `, episode facts: ${episodeContext.episodeFacts.length}` : '') +
        (episodeContext.verifiedFacts.length > 0 ? `, verified facts: ${episodeContext.verifiedFacts.length}` : ''),
    );

    // Format verified facts for factual content types
    const verifiedFactsContext =
      episodeContext.verifiedFacts.length > 0
        ? formatVerifiedFactsForPrompt(episodeContext.verifiedFacts)
        : undefined;

    // 3. Run the Stage 1 Story Orchestrator
    const { runStoryOrchestrator } = await import(
      '@kit/episodes/agent/story-orchestrator'
    );

    // Format thread candidates for the orchestrator
    const threadCandidatesContext = data.threadCandidates?.length
      ? data.threadCandidates
          .map((t) => `- ${t.action.toUpperCase()}: "${t.threadName}"`)
          .join('\n')
      : undefined;

    const orchestratorResult = await runStoryOrchestrator(
      {
        episodeId: data.episodeId,
        episodeTitle: data.title,
        episodeLogline: data.logline,
        genre: episodeContext.genre ?? 'general',
        targetAudience: episodeContext.targetAudience ?? 'general',
        targetDurationSeconds: data.targetDuration,
        contentStyle,
        projectId: data.projectId,
        episodeNumber: episodeContext.episodeNumber ?? 1,
        accountId: data.accountId,
        contentType: episodeContext.projectType,
        verifiedFacts: verifiedFactsContext,
        charactersContext,
        locationsContext,
        seasonContext,
        previousEpisodesContext,
        visualStyle: episodeContext.visualStyle,
        verifiedFacts: factsContext || undefined,
        recurringElementsContext: recurringElementContext,
        threadCandidatesContext,
        ideationThemes: data.themes,
        ideationHook: data.hook,
        visualDirection: data.visualDirection,
      },
      supabase,
    );

    if (!orchestratorResult.success) {
      throw new Error(
        `Story Orchestrator failed: ${orchestratorResult.error ?? 'Unknown error'}`,
      );
    }

    console.log(
      `[Story Generation] Stage 1 complete. Steps: ${orchestratorResult.orchestratorSteps}, Viral score: ${orchestratorResult.viralQuality?.overallScore?.toFixed(2) ?? 'N/A'}`,
    );

    const generatedAt = new Date().toISOString();
    const storyText = orchestratorResult.storyText ?? '';

    // 4. Build story_data for DB write (Orchestrator handles screenplay_data and shots)
    const storyData = {
      premise: data.logline,
      fullStory: storyText,
      generatedAt,
      generatedBy: {
        mode: 'agentic',
        orchestratorSteps: orchestratorResult.orchestratorSteps,
        viralScore: orchestratorResult.viralQuality?.overallScore,
      },
      title: data.title,
      targetDuration: data.targetDuration,
      contentStyle,
      genre: episodeContext.genre,
      targetAudience: episodeContext.targetAudience,
      videoStyle: episodeContext.visualStyle,
      // Structured story metadata (for Story Info sidebar)
      actBreakdown: orchestratorResult.actBreakdown,
      characters: orchestratorResult.storyCharacters,
      themes: orchestratorResult.themes,
      tone: orchestratorResult.tone,
      estimatedSceneCount: orchestratorResult.estimatedSceneCount,
      episodeSummary: orchestratorResult.episodeSummary,
      sentimentScore: orchestratorResult.sentimentScore,
      keyEvents: orchestratorResult.keyEvents,
      viralStructure: orchestratorResult.viralStructure,
      // Viral quality inline for quick access
      viralQuality: orchestratorResult.viralQuality,
    };

    // 5. Guard: Skip write if episode was deleted or job was cancelled
    const { data: currentEpisode } = await supabase
      .from('episodes')
      .select('status, deleted_at')
      .eq('id', data.episodeId)
      .single();

    if (!currentEpisode || currentEpisode.deleted_at) {
      console.warn(
        '[Story Generation] Episode was deleted during generation. Skipping write.',
      );
      await markJobCompleted(supabase, data.episodeId, 'story', {
        skipped: true,
        reason: 'episode-deleted',
      });

      return {
        success: false,
        data: {
          story: {
            fullText: '',
            title: data.title,
            actBreakdown: [],
            characters: [],
            themes: [],
            tone: '',
            estimatedSceneCount: 0,
          },
          episode: { id: data.episodeId, status: 'draft', version: 0 },
          metadata: {
            provider: 'skipped',
            model: 'skipped',
            costCents: 0,
            tokensUsed: 0,
            generatedAt: new Date().toISOString(),
          },
        },
      };
    }

    // Also check if the generation job was explicitly cancelled by the user
    const { data: activeJob } = await supabase
      .from('generation_jobs')
      .select('status')
      .eq('reference_type', 'episode')
      .eq('reference_id', data.episodeId)
      .eq('job_type', 'story')
      .in('status', ['queued', 'processing'])
      .limit(1)
      .maybeSingle();

    if (!activeJob) {
      console.warn(
        '[Story Generation] No active generation job found (may have been cancelled). Skipping write.',
      );
      return {
        success: false,
        data: {
          story: {
            fullText: '',
            title: data.title,
            actBreakdown: [],
            characters: [],
            themes: [],
            tone: '',
            estimatedSceneCount: 0,
          },
          episode: { id: data.episodeId, status: 'draft', version: 0 },
          metadata: {
            provider: 'skipped',
            model: 'skipped',
            costCents: 0,
            tokensUsed: 0,
            generatedAt: new Date().toISOString(),
          },
        },
      };
    }

    // 6. UPDATE DATABASE: episode.story_data + status → 'story'
    const { data: updatedEpisode, error: updateError } = await supabase
      .from('episodes')
      .update({
        story_data: storyData,
        status: 'story',
        target_duration_seconds: data.targetDuration,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.episodeId)
      // NOTE: No .eq('version', ...) — the orchestrator writes viral_quality
      // mid-run which bumps the version via DB trigger (see: f64c9648)
      .is('deleted_at', null)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update episode: ${updateError.message}`);
    }

    if (!updatedEpisode) {
      throw new Error('Episode not found or was deleted');
    }

    console.log(
      `[Story Generation] Stage 1 complete. Status: story. ` +
        `Viral score: ${orchestratorResult.viralQuality?.overallScore?.toFixed(2) ?? 'N/A'}. ` +
        `Stage 2 (Screenplay) will run on user action.`,
    );

    // Mark job as completed
    await markJobCompleted(supabase, data.episodeId, 'story', {
      mode: 'agentic-stage1',
      orchestratorSteps: orchestratorResult.orchestratorSteps,
      viralScore: orchestratorResult.viralQuality?.overallScore,
    });

    // 6. Commit story outputs to Canon tables (non-fatal)
    try {
      await commitStoryCanon({
        projectId: data.projectId,
        episodeId: data.episodeId,
        episodeNumber: episodeContext.episodeNumber ?? 1,
        season: episodeContext.seasonNumber ?? 1,
        keyEvents: orchestratorResult.keyEvents ?? [],
        characters: orchestratorResult.storyCharacters ?? [],
        episodeSummary: orchestratorResult.episodeSummary,
        themes: orchestratorResult.themes,
        storyContent: storyText,
        createdBy: data.userId,
        supabase,
      });
    } catch (canonError) {
      console.warn(
        '[Story Generation] Canon commit failed (non-fatal):',
        canonError,
      );
    }

    // 7. Auto-create assets for LLM-invented characters and locations (non-fatal)
    try {
      await autoCreateNewAssets(
        supabase,
        data.projectId,
        data.episodeId,
        orchestratorResult.newCharacters ?? [],
        orchestratorResult.newLocations ?? [],
      );
    } catch (assetError) {
      console.warn(
        '[Story Generation] Auto-create assets failed (non-fatal):',
        assetError,
      );
    }

    // Synthesize a StoryOutput for the return value
    const story: StoryOutput = {
      fullText: storyText,
      title: data.title,
      actBreakdown: [],
      characters: episodeContext.characters.map((c) => c.name),
      themes: [],
      tone: contentStyle,
      estimatedSceneCount: scaling.screenplay.sceneCountMin,
      episodeSummary: orchestratorResult.viralQuality?.whyThisWorks,
      sentimentScore: orchestratorResult.viralQuality?.overallScore,
    };

    return {
      success: true,
      data: {
        story,
        episode: {
          id: updatedEpisode.id,
          status: updatedEpisode.status,
          version: updatedEpisode.version,
        },
        metadata: {
          provider: 'orchestrator',
          model: 'multi-agent',
          costCents: 0, // Orchestrator tracks cost internally
          tokensUsed: 0,
          generatedAt,
          orchestratorSteps: orchestratorResult.orchestratorSteps,
        },
      },
    };
  } catch (error) {
    await markJobFailed(
      supabase,
      data.episodeId,
      'story',
      error instanceof Error ? error.message : 'Unknown error',
    );
    throw error;
  }
}
