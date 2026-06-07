/**
 * Screenplay Conversion Handler
 *
 * Converts a story to screenplay format and extracts dialogue lines.
 * WRITES TO DATABASE:
 * - Updates episode.screenplay_data and status
 * - Inserts dialogue_lines
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
} from '../utils/job-tracking';

interface ScreenplayConversionPayload {
  episodeId: string;
  dialogueStyle?: string;
  contentStyle?: string;
  version: number;
  accountId: string;
  userId: string;
  projectId: string;
}

interface DialogueLine {
  character: string;
  dialogue: string;
  parenthetical?: string;
  sceneNumber: number;
}

interface ScreenplayScene {
  number: number;
  heading: string;
  location: string;
  timeOfDay: string;
  description: string;
  action: string[];
  dialogue: DialogueLine[];
  transitions?: string;
}

interface ScreenplayOutput {
  screenplay: {
    title: string;
    scenes: ScreenplayScene[];
    totalDialogueLines: number;
    estimatedDuration: number;
  };
}

interface ScreenplayConversionResult {
  success: boolean;
  data: {
    screenplay: ScreenplayOutput['screenplay'];
    dialogueLinesCreated: number;
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
    };
  };
}

export async function processScreenplayConversion(
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<ScreenplayConversionResult> {
  const data = payload as ScreenplayConversionPayload;

  console.log(
    `[Screenplay Conversion] Processing for episode ${data.episodeId}`,
  );

  // Mark job as processing
  await markJobProcessing(supabase, data.episodeId, 'screenplay');

  try {
    // 1. Fetch episode with story data
    const { data: episode, error: episodeError } = await supabase
      .from('episodes')
      .select(
        `
            id, number, title, version, status, story_data, target_duration_seconds,
            project:projects(id, account_id, metadata)
        `,
      )
      .eq('id', data.episodeId)
      .single();

    if (episodeError || !episode) {
      throw new Error(`Episode not found: ${episodeError?.message}`);
    }

    const storyData = episode.story_data as Record<string, unknown> | null;
    if (!storyData?.fullStory) {
      throw new Error('Episode must have a story generated first');
    }

    // 2. Build episode context using episode.metadata.character_ids/location_ids
    // This ensures we use the episode-specific characters/locations, not all project assets
    const {
      buildEpisodeContext,
      formatCharactersForPrompt,
      formatLocationsForPrompt,
      formatRecurringElementsForPrompt,
      mergeCharacterArcs,
    } = await import('../utils/context-builder');

    const episodeContext = await buildEpisodeContext(data.episodeId, supabase);
    const directionNotes = episodeContext.seasonDirectionNotes ?? undefined;
    const characters = episodeContext.characters;
    const locations = episodeContext.locations;

    const charactersFormatted = formatCharactersForPrompt(characters);
    const _locationsFormatted = formatLocationsForPrompt(locations);
    const recurringElementsFormatted = formatRecurringElementsForPrompt(
      episodeContext.recurringElements,
    );

    // Validate and extract structured story metadata using Zod for runtime safety.
    // storyData is a JSONB column — treat it as untrusted data at this boundary.
    const { z } = await import('zod');

    const actBreakdownSchema = z
      .object({ act1: z.string(), act2: z.string(), act3: z.string() })
      .catch({ act1: '', act2: '', act3: '' });

    const storyCharacterSchema = z
      .array(
        z.object({
          name: z.string(),
          role: z.string(),
          arc: z.string(),
        }),
      )
      .catch([]);

    const actBreakdown = actBreakdownSchema.parse(storyData.actBreakdown);
    const tone = z.string().catch('').parse(storyData.tone);
    const themes = z.array(z.string()).catch([]).parse(storyData.themes);
    const storyCharacters = storyCharacterSchema.parse(storyData.characters);
    const keyEvents = z.array(z.string()).catch([]).parse(storyData.keyEvents);

    if (!storyData.tone || !storyData.actBreakdown) {
      console.warn(
        `[Screenplay Conversion] Legacy episode missing enrichment fields ` +
          `(tone: ${!!storyData.tone}, actBreakdown: ${!!storyData.actBreakdown}). ` +
          `Proceeding with available data.`,
      );
    }

    // Merge story-specific character arcs into asset-based character context
    const enrichedCharactersFormatted = mergeCharacterArcs(
      charactersFormatted,
      storyCharacters,
    );

    console.log(
      `[Screenplay Conversion] Episode context: ${characters.length} characters, ${locations.length} locations, ` +
        `enrichment: tone=${!!tone}, acts=${!!actBreakdown.act1}, themes=${themes.length}, keyEvents=${keyEvents.length}`,
    );

    const projectMetadata =
      (episode.project?.metadata as Record<string, unknown>) || {};

    // Import content scaling utilities from local Lambda utils (avoids server-only issues)
    const { calculateContentScaling } = await import(
      '../utils/duration-scaling'
    );
    type ContentStyle = 'dialogue-heavy' | 'action-heavy' | 'balanced';

    // Get target duration and content style
    const targetDuration =
      episode.target_duration_seconds || storyData.targetDuration || 300;
    const contentStyle = (data.contentStyle ||
      storyData.contentStyle ||
      'dialogue-heavy') as ContentStyle;

    // Calculate scene and dialogue scaling based on duration
    const scaling = calculateContentScaling({
      targetDurationSeconds: targetDuration,
      contentStyle,
    });

    // Get character and location names for the prompt
    const characterNames =
      characters.map((c) => c.name).join(', ') || 'No characters';
    const locationNames =
      locations.map((l) => l.name).join(', ') || 'Various locations';

    // 3. Run the Stage 2 Screenplay Orchestrator
    const { runScreenplayOrchestrator } = await import(
      '@kit/episodes/agent/screenplay-orchestrator'
    );

    const orchestratorResult = await runScreenplayOrchestrator({
      episodeId: data.episodeId,
      episodeTitle: episode.title,
      episodeNumber: episode.number ?? 1,
      genre: (projectMetadata.genre as string) || 'general',
      targetAudience: (projectMetadata.targetAudience as string) || 'general',
      targetDurationSeconds: targetDuration,
      contentStyle,
      accountId: data.accountId,
      storyText: storyData.fullStory as string,
      charactersContext:
        enrichedCharactersFormatted || 'No characters defined.',
      characterNames,
      locationNames,
      recurringElementsContext: recurringElementsFormatted,
      sceneCountMin: scaling.screenplay.sceneCountMin,
      sceneCountMax: scaling.screenplay.sceneCountMax,
      dialogueLinesPerSceneMin: scaling.screenplay.dialogueLinesPerSceneMin,
      dialogueLinesPerSceneMax: scaling.screenplay.dialogueLinesPerSceneMax,
      // Story metadata enrichment
      actBreakdown,
      tone,
      themes,
      keyEvents,
      directionNotes,
    });

    if (!orchestratorResult.success || orchestratorResult.scenes.length === 0) {
      throw new Error(
        `Screenplay Orchestrator failed: ${orchestratorResult.error ?? 'No scenes generated'}`,
      );
    }

    const costCents = 0; // Agent orchestrator tracks cost internally
    const generatedAt = new Date().toISOString();

    // 4. FILM-1104: Run SCREENPLAY validation checkpoint
    try {
      const { runValidationCheckpoint } = await import(
        '../utils/validation-checkpoint'
      );

      const sceneBlocks = orchestratorResult.scenes.map((scene) => ({
        sceneNumber: scene.number,
        content: `${scene.heading}\n${scene.description}\n${scene.action?.join('\n') ?? ''}`,
      }));

      const validation = await runValidationCheckpoint(
        {
          checkpoint: 'SCREENPLAY',
          enforcement: 'flexible', // Warn, don't block
          projectId: data.projectId,
          episodeNumber: episode.number ?? 1,
          supabase,
        },
        { sceneBlocks },
      );

      if (validation.messages.length > 0) {
        console.log(
          `[Screenplay Conversion] Continuity validation: ${validation.messages.join(' | ')}`,
        );
      }
    } catch (err) {
      console.warn(
        '[Screenplay Conversion] Validation checkpoint skipped:',
        err,
      );
    }

    // 4b. Run SCREENPLAY quality evaluation (non-blocking, advisory)
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const screenplayText = orchestratorResult.scenes
        .map(
          (scene) =>
            `${scene.heading}\n${scene.description}\n${(scene.action ?? []).join('\n')}`,
        )
        .join('\n\n');

      const targetSceneRange = `${scaling.screenplay.sceneCountMin}-${scaling.screenplay.sceneCountMax} scenes for ${Math.round(targetDuration / 60)} minutes`;

      const qualityResult = await executeLLM<{
        overallScore: number;
        dimensions: Record<string, number>;
        critique: string;
        revisionPriority: string;
      }>({
        templateSlug: 'quality-evaluation/screenplay-quality',
        variables: {
          screenplay_content: screenplayText,
          context_hint: `Episode "${episode.title}" — target: ${Math.round(targetDuration / 60)} minutes, genre: ${projectMetadata.genre ?? 'general'}`,
          target_scene_count: targetSceneRange,
        },
        context: {
          name: 'screenplay-quality-eval',
          accountId: data.accountId,
          userId: data.userId,
        },
        supabaseClient: supabase,
      });

      const score = qualityResult.data?.overallScore ?? 0;
      console.log(
        `[Screenplay Conversion] Quality score: ${score.toFixed(2)} — ${qualityResult.data?.critique ?? 'No critique'}`,
      );

      if (score < 0.65) {
        console.warn(
          `[Screenplay Conversion] Low quality score (${score.toFixed(2)}). Revision priority: ${qualityResult.data?.revisionPriority ?? 'N/A'}`,
        );
      }
    } catch (err) {
      console.warn(
        '[Screenplay Conversion] Quality evaluation skipped:',
        err instanceof Error ? err.message : err,
      );
    }

    // Extract unique locations from all scenes
    const uniqueLocations = [
      ...new Set(
        orchestratorResult.scenes
          .map((scene) => scene.location)
          .filter((loc): loc is string => Boolean(loc)),
      ),
    ];

    // Extract unique characters from all dialogue lines across all scenes
    const uniqueCharacters = [
      ...new Set(
        orchestratorResult.scenes
          .flatMap((scene) => scene.dialogue || [])
          .map((line) => line.character)
          .filter((char): char is string => Boolean(char)),
      ),
    ];

    // Calculate total estimated duration from all scenes
    const totalEstimatedDuration = orchestratorResult.scenes.reduce(
      (sum, scene) => sum + (scene.estimatedDuration || 0),
      0,
    );

    const screenplayData = {
      scenes: orchestratorResult.scenes,
      generatedAt,
      generatedBy: {
        model: 'screenplay-orchestrator',
        provider: 'multi-agent',
        costCents,
      },
      totalDialogueLines: orchestratorResult.scenes.flatMap(
        (s) => s.dialogue || [],
      ).length,
      estimatedDuration: totalEstimatedDuration,
      approvedAt: null,
      // Full metadata for episode header display
      metadata: {
        locations: uniqueLocations,
        characters: uniqueCharacters,
        totalScenes: orchestratorResult.scenes.length,
        estimatedDuration: totalEstimatedDuration,
      },
    };

    // 5. Guard: Skip write if episode was deleted during processing
    const { data: currentEpisode } = await supabase
      .from('episodes')
      .select('status, deleted_at')
      .eq('id', data.episodeId)
      .single();

    if (!currentEpisode || currentEpisode.deleted_at) {
      console.warn(
        '[Screenplay Conversion] Episode was deleted during generation. Skipping write.',
      );
      await markJobCompleted(supabase, data.episodeId, 'screenplay', {
        skipped: true,
        reason: 'episode-deleted',
      });

      return {
        success: true,
        data: {
          screenplay: {
            title: episode.title,
            scenes: [],
            totalDialogueLines: 0,
            estimatedDuration: 0,
          },
          dialogueLinesCreated: 0,
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

    // 5b. UPDATE episode with screenplay_data
    const { data: updatedEpisode, error: updateError } = await supabase
      .from('episodes')
      .update({
        screenplay_data: screenplayData,
        status: 'storyboard',
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.episodeId)
      // NOTE: No .eq('version', ...) — version may drift during orchestrator mid-run writes
      .is('deleted_at', null)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update episode: ${updateError.message}`);
    }

    if (!updatedEpisode) {
      throw new Error('Episode not found or was deleted');
    }

    // 6. Extract and INSERT dialogue lines
    // Create a character name to ID map
    const characterMap = new Map(
      (characters || []).map((c) => [c.name.toLowerCase(), c.id]),
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
    for (const scene of orchestratorResult.scenes) {
      for (const line of scene.dialogue) {
        const characterId =
          characterMap.get(line.character.toLowerCase()) || null;
        dialogueLines.push({
          episode_id: data.episodeId,
          character_asset_id: characterId,
          text: line.text, // Fixed: prompt template uses 'text' not 'dialogue'
          sequence_number: sequenceNumber++,
          scene_number: scene.number,
          language: 'en',
          status: 'pending',
        });
      }
    }

    if (dialogueLines.length > 0) {
      // Delete existing dialogue lines before inserting new ones
      // Prevents orphaned lines from previous generations
      const { error: deleteDialogueError } = await supabase
        .from('dialogue_lines')
        .delete()
        .eq('episode_id', data.episodeId);

      if (deleteDialogueError) {
        console.warn(
          '[Screenplay Conversion] Failed to delete old dialogue lines:',
          deleteDialogueError,
        );
      }

      const { error: insertError } = await supabase
        .from('dialogue_lines')
        .insert(dialogueLines);

      if (insertError) {
        console.error(
          '[Screenplay Conversion] Failed to insert dialogue:',
          insertError,
        );
        // Don't throw - screenplay was saved successfully
      }
    }

    console.log(
      `[Screenplay Conversion] Created ${orchestratorResult.scenes.length} scenes, ${dialogueLines.length} dialogue lines`,
    );

    // Mark job as completed
    await markJobCompleted(supabase, data.episodeId, 'screenplay', {
      model: 'screenplay-orchestrator',
      provider: 'multi-agent',
      costCents,
      scenesCreated: orchestratorResult.scenes.length,
      dialogueLinesCreated: dialogueLines.length,
    });

    return {
      success: true,
      data: {
        screenplay: {
          title: episode.title,
          scenes: orchestratorResult.scenes,
          totalDialogueLines: dialogueLines.length,
          estimatedDuration: totalEstimatedDuration,
        },
        dialogueLinesCreated: dialogueLines.length,
        episode: {
          id: updatedEpisode.id,
          status: updatedEpisode.status,
          version: updatedEpisode.version,
        },
        metadata: {
          provider: 'multi-agent',
          model: 'screenplay-orchestrator',
          costCents,
          tokensUsed: 0,
          generatedAt,
        },
      },
    };
  } catch (error) {
    // Mark job as failed
    await markJobFailed(
      supabase,
      data.episodeId,
      'screenplay',
      error instanceof Error ? error.message : 'Unknown error',
    );
    throw error;
  }
}
