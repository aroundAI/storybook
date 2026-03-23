/**
 * Story Generation Handler — Agentic Mode
 *
 * Entry point for the full multi-agent content generation pipeline.
 * Instead of a single LLM call, this invokes the Content Generation Orchestrator,
 * which coordinates 6 specialist agents across all 4 stages:
 *
 *   Stage 1: Story Director → Viral Analyst → Continuity Guardian → (revision loop)
 *   Stage 2: Screenplay Director
 *   Stage 3: Reel Scout
 *   Stage 4: Shot Director
 *
 * The Orchestrator persists screenplay_data, shots, and viral_quality to the DB.
 * This handler only persists story_data and marks the job.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildEpisodeContext,
  formatCharactersForPrompt,
  formatCharactersForVeoPrompt,
  formatLocationsForPrompt,
  formatLocationsForVeoPrompt,
  formatPreviousEpisodesForPrompt,
  formatRecurringElementForPrompt,
  formatBeatsForPrompt,
} from '../utils/context-builder';
import {
  type ContentStyle,
  calculateContentScaling,
  formatDuration,
} from '../utils/duration-scaling';
import {
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
} from '../utils/job-tracking';

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

  console.log(`[Story Generation] Starting AGENTIC pipeline for episode ${data.episodeId}`);

  // Mark job as processing
  await markJobProcessing(supabase, data.episodeId, 'story');

  try {
    // 1. Build rich context using shared context-builder
    const episodeContext = await buildEpisodeContext(data.episodeId, supabase);

    const contentStyle = (data.contentStyle ?? 'dialogue-heavy') as ContentStyle;
    const scaling = calculateContentScaling({
      targetDurationSeconds: data.targetDuration,
      contentStyle,
    });

    // 2. Pre-format all context blocks (shared across all agents)
    const charactersContext = formatCharactersForPrompt(episodeContext.characters);
    const locationsContext = formatLocationsForPrompt(episodeContext.locations);
    const charactersVeoContext = formatCharactersForVeoPrompt(episodeContext.characters);
    const locationsVeoContext = formatLocationsForVeoPrompt(episodeContext.locations);
    const previousEpisodesContext = formatPreviousEpisodesForPrompt(
      episodeContext.previousEpisodes,
    );
    const seasonContext = episodeContext.seasonPremise
      ? `This is Episode ${episodeContext.episodeNumber}${episodeContext.seasonNumber ? ` of Season ${episodeContext.seasonNumber}` : ''}. Season Premise: ${episodeContext.seasonPremise}`
      : '';

    console.log(
      `[Story Generation] Context built: ${episodeContext.characters.length} characters, ${episodeContext.locations.length} locations`,
    );

    // 3. Run the full multi-agent orchestrator
    const { runContentOrchestrator } = await import(
      '@kit/episodes/agent/orchestrator'
    );

    const orchestratorResult = await runContentOrchestrator(
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
        // Pre-formatted context blocks
        charactersContext,
        locationsContext,
        charactersVeoContext,
        locationsVeoContext,
        seasonContext,
        previousEpisodesContext,
        visualStyle: episodeContext.visualStyle,
      },
      supabase,
    );

    if (!orchestratorResult.success) {
      throw new Error(
        `Orchestrator failed: ${orchestratorResult.error ?? 'Unknown error'}`,
      );
    }

    console.log(
      `[Story Generation] Orchestrator complete. Steps: ${orchestratorResult.orchestratorSteps}, Viral score: ${orchestratorResult.viralQuality?.overallScore?.toFixed(2) ?? 'N/A'}`,
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
      // Viral quality inline for quick access
      viralQuality: orchestratorResult.viralQuality,
    };

    // 5. UPDATE DATABASE: episode.story_data + status
    const { data: updatedEpisode, error: updateError } = await supabase
      .from('episodes')
      .update({
        story_data: storyData,
        status: orchestratorResult.screenplay ? 'storyboard' : 'story',
        target_duration_seconds: data.targetDuration,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.episodeId)
      .eq('version', data.version)
      .is('deleted_at', null)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update episode: ${updateError.message}`);
    }

    if (!updatedEpisode) {
      throw new Error('Episode was modified by another user (optimistic lock failed)');
    }

    // 6. Insert dialogue_lines from screenplay (if orchestrator generated screenplay)
    if (orchestratorResult.screenplay?.scenes) {
      try {
        const characterMap = new Map(
          episodeContext.characters.map((c) => [c.name.toLowerCase(), c.id]),
        );

        const dialogueLines: Array<{
          episode_id: string;
          character_asset_id: string | null;
          text: string;
          sequence_number: number;
          scene_number: number;
          language: string;
          status: string;
        }> = [];

        let sequenceNumber = 1;
        for (const scene of orchestratorResult.screenplay.scenes as Array<{
          number: number;
          dialogue?: Array<{ character: string; text: string }>;
        }>) {
          for (const line of scene.dialogue ?? []) {
            dialogueLines.push({
              episode_id: data.episodeId,
              character_asset_id:
                characterMap.get(line.character?.toLowerCase()) ?? null,
              text: line.text,
              sequence_number: sequenceNumber++,
              scene_number: scene.number,
              language: 'en',
              status: 'pending',
            });
          }
        }

        if (dialogueLines.length > 0) {
          const { error: insertError } = await supabase
            .from('dialogue_lines')
            .insert(dialogueLines);

          if (insertError) {
            console.warn('[Story Generation] Dialogue lines insert failed (non-fatal):', insertError.message);
          } else {
            console.log(`[Story Generation] ${dialogueLines.length} dialogue lines inserted`);
          }
        }
      } catch (err) {
        console.warn('[Story Generation] Dialogue extraction skipped:', err);
      }
    }

    console.log(
      `[Story Generation] Episode updated. Status: ${updatedEpisode.status}. ` +
      `Screenplay: ${orchestratorResult.screenplay ? 'yes' : 'no'}, ` +
      `Shots: ${orchestratorResult.shots ? (orchestratorResult.shots as unknown[]).length : 0}`,
    );

    // Mark job as completed
    await markJobCompleted(supabase, data.episodeId, 'story', {
      mode: 'agentic',
      orchestratorSteps: orchestratorResult.orchestratorSteps,
      viralScore: orchestratorResult.viralQuality?.overallScore,
      generatedScreenplay: !!orchestratorResult.screenplay,
      generatedShots: !!(orchestratorResult.shots as unknown[] | undefined)?.length,
    });

    // Synthesize a StoryOutput for the return value
    const story: StoryOutput = {
      fullText: storyText,
      title: data.title,
      actBreakdown: [],
      characters: episodeContext.characters.map((c) => c.name),
      themes: [],
      tone: contentStyle,
      estimatedSceneCount:
        (orchestratorResult.screenplay?.scenes as unknown[] | undefined)?.length ?? scaling.screenplay.sceneCountMin,
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
