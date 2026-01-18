/**
 * Shot Generation Handler
 *
 * Generates shot list from screenplay using parallel scene processing.
 * WRITES TO DATABASE:
 * - Inserts rows into shots table
 * - Updates episode.shot_list
 *
 * This is the most complex handler - processes scenes in parallel batches.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
} from '../utils/job-tracking';
import { parseTimeToSeconds } from '../utils/time-utils';

interface ShotGenerationPayload {
  episodeId: string;
  version: number;
  accountId: string;
  userId: string;
  projectId: string;
}

interface ScreenplayScene {
  number: number;
  heading: string;
  location: string;
  timeOfDay: string;
  description: string;
  action: string[];
  dialogue: Array<{
    character: string;
    dialogue: string;
    parenthetical?: string;
  }>;
}

interface VeoPrompt {
  shotLine: string;
  timeline: Array<{
    startTime: string;
    endTime: string;
    type: 'action' | 'dialogue' | 'transition';
    character?: string | null;
    content: string;
    emotion?: string | null;
  }>;
  audio: string;
  style: string;
  avoid: string;
  fullPrompt: string;
  audioCues?: Array<{
    type: 'sfx' | 'ambient' | 'music';
    prompt: string;
    startOffset: number;
    duration: number;
    isLoopable?: boolean;
  }>;
}

interface GeneratedShot {
  shotNumber: number;
  shotType: string;
  cameraDirection: string;
  description: string;
  duration: number;
  characters: string[];
  metadata: {
    location: string;
    timeOfDay: string;
    mood?: string;
    lighting?: string;
  };
  veoPrompt: VeoPrompt;
  shortsCandidate?: boolean;
  shortsMetadata?: {
    viralScore: number;
    hookType?: string;
    standaloneSummary?: string;
  };
}

interface SceneResult {
  sceneNumber: number;
  shots: GeneratedShot[];
  sceneSummary: string;
}

interface ShotGenerationResult {
  success: boolean;
  data: {
    totalShots: number;
    shotsCreated: number;
    metadata: {
      totalDuration: number;
      shotTypes: { wide: number; medium: number; closeUp: number };
      scenesProcessed: number;
    };
  };
}

const PARALLEL_CONCURRENCY = 5; // Process 5 scenes at a time

export async function processShotGeneration(
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<ShotGenerationResult> {
  const data = payload as ShotGenerationPayload;

  console.log(`[Shot Generation] Processing for episode ${data.episodeId}`);

  // Mark job as processing
  await markJobProcessing(supabase, data.episodeId, 'shot_list');

  try {
    // 1. Fetch episode with screenplay
    const { data: episode, error: episodeError } = await supabase
      .from('episodes')
      .select(
        `
            id, title, version, screenplay_data, story_data,
            project:projects(id, account_id, metadata)
        `,
      )
      .eq('id', data.episodeId)
      .single();

    if (episodeError || !episode) {
      throw new Error(`Episode not found: ${episodeError?.message}`);
    }

    const screenplayData = episode.screenplay_data as {
      scenes: ScreenplayScene[];
    } | null;
    if (!screenplayData?.scenes?.length) {
      throw new Error('Episode must have screenplay generated first');
    }

    const scenes = screenplayData.scenes;

    // 2. Build episode context using episode.metadata.character_ids/location_ids
    // This ensures we use the episode-specific characters/locations, not all project assets
    const {
      buildEpisodeContext,
      formatCharactersForVeoPrompt,
      formatLocationsForVeoPrompt,
    } = await import('../utils/context-builder');

    const episodeContext = await buildEpisodeContext(data.episodeId, supabase);
    const characters = episodeContext.characters;
    const locations = episodeContext.locations;

    console.log(
      `[Shot Generation] Episode context: ${characters.length} characters, ${locations.length} locations`,
    );

    // Format using VEO 3.1 optimized formatters
    const charactersFormatted =
      formatCharactersForVeoPrompt(characters) || 'No characters defined.';
    const locationsFormatted =
      formatLocationsForVeoPrompt(locations) || 'No locations defined.';

    const storyData = (episode.story_data as Record<string, unknown>) || {};

    // Use episode context for consistent project settings
    const episodeMetadata = JSON.stringify({
      title: episode.title,
      genre: episodeContext.genre,
      targetAudience: episodeContext.targetAudience,
      visualStyle: episodeContext.visualStyle,
      aestheticStyle: episodeContext.aestheticStyle, // Project aesthetic style
      tone: storyData.tone || 'balanced',
    });

    // 3. Process scenes in parallel batches
    const { executeLLM } = await import('@kit/prompt-engine/server');
    const sceneResults: SceneResult[] = [];

    for (
      let batchStart = 0;
      batchStart < scenes.length;
      batchStart += PARALLEL_CONCURRENCY
    ) {
      const batch = scenes.slice(batchStart, batchStart + PARALLEL_CONCURRENCY);

      console.log(
        `[Shot Generation] Processing scenes ${batchStart + 1}-${Math.min(batchStart + PARALLEL_CONCURRENCY, scenes.length)}`,
      );

      const batchPromises = batch.map(async (scene, batchIndex) => {
        const sceneNumber = scene.number || batchStart + batchIndex + 1;

        // Include audioCues from screenplay for Stage 2 refinement
        const sceneContent = JSON.stringify({
          number: sceneNumber,
          heading: scene.heading,
          location: scene.location,
          timeOfDay: scene.timeOfDay,
          description: scene.description,
          action: scene.action,
          dialogue: scene.dialogue,
          audioCues: scene.audioCues || [], // Scene-level audio design from screenplay
        });

        try {
          const result = await executeLLM<{
            shots: GeneratedShot[];
            sceneSummary: string;
          }>({
            templateSlug: 'scene-shot-generation',
            variables: {
              scene_number: sceneNumber,
              total_scenes: scenes.length,
              characters: charactersFormatted,
              locations: locationsFormatted,
              episode_metadata: episodeMetadata,
              previous_scene_summary: 'Context from parallel processing.',
              scene_content: sceneContent,
            },
            context: {
              name: `shot-list.scene-${sceneNumber}`,
              accountId: data.accountId,
              userId: data.userId,
            },
            temperature: 0.4,
            supabaseClient: supabase,
          });

          return {
            sceneNumber,
            shots: result.data.shots,
            sceneSummary: result.data.sceneSummary,
          };
        } catch (error) {
          console.error(
            `[Shot Generation] Scene ${sceneNumber} failed:`,
            error,
          );
          return { sceneNumber, shots: [], sceneSummary: '' };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      sceneResults.push(...batchResults);
    }

    // Sort by scene number
    sceneResults.sort((a, b) => a.sceneNumber - b.sceneNumber);

    // 4. Query existing shots for correct sequence number base (matching batchCreateShotsAction)
    const { data: existingShots } = await supabase
      .from('shots')
      .select('sequence_number')
      .eq('episode_id', data.episodeId)
      .is('deleted_at', null)
      .order('sequence_number', { ascending: false })
      .limit(1);

    let sequenceNumber = (existingShots?.[0]?.sequence_number ?? 0) + 1;
    console.log(
      `[Shot Generation] Starting sequence number: ${sequenceNumber}`,
    );

    // 5. Aggregate shots with global sequence numbers (matching batchCreateShotsAction)
    const allShots: Array<{
      episode_id: string;
      scene_number: number;
      shot_number: number;
      sequence_number: number;
      scene_description: string;
      prompt: string;
      duration_seconds: number;
      camera_direction: string | null;
      status: string;
      generation_metadata: Record<string, unknown>;
    }> = [];

    const shotTypes = { wide: 0, medium: 0, closeUp: 0 };
    let totalDuration = 0;

    for (const sceneResult of sceneResults) {
      for (const shot of sceneResult.shots) {
        // Derive action from timeline events (matching local aggregateSceneResults)
        const derivedAction =
          shot.veoPrompt?.timeline
            ?.filter((event) => event.type === 'action')
            .map((event) => event.content)
            .join(' ') || shot.description;

        // Extract dialogue timing for audio sync (matching local aggregateSceneResults)
        const dialogueTiming =
          shot.veoPrompt?.timeline
            ?.filter((event) => event.type === 'dialogue' && event.character)
            .map((event) => ({
              startSeconds: parseTimeToSeconds(event.startTime),
              durationSeconds:
                parseTimeToSeconds(event.endTime) -
                parseTimeToSeconds(event.startTime),
              characterName: event.character || 'Unknown',
              text: event.content,
              emotion: event.emotion || null,
            })) || [];

        allShots.push({
          episode_id: data.episodeId,
          scene_number: sceneResult.sceneNumber,
          shot_number: shot.shotNumber,
          sequence_number: sequenceNumber++,
          scene_description: shot.description,
          prompt: shot.veoPrompt?.fullPrompt || shot.description,
          duration_seconds: shot.duration,
          camera_direction: shot.cameraDirection ?? null,
          status: 'pending',
          generation_metadata: {
            shotType: shot.shotType,
            location: shot.metadata.location,
            timeOfDay: shot.metadata.timeOfDay,
            mood: shot.metadata.mood,
            characters: shot.characters ?? [],
            action: derivedAction,
            dialogueTiming:
              dialogueTiming.length > 0 ? dialogueTiming : undefined,
            veoPrompt: shot.veoPrompt,
            shortsCandidate: shot.shortsCandidate,
            shortsMetadata: shot.shortsMetadata,
          },
        });

        // Track stats
        if (shot.shotType === 'wide') shotTypes.wide++;
        else if (shot.shotType === 'medium') shotTypes.medium++;
        else if (shot.shotType?.includes('close')) shotTypes.closeUp++;
        totalDuration += shot.duration;
      }
    }

    if (allShots.length === 0) {
      throw new Error('No shots were generated');
    }

    // 5. INSERT shots
    const { error: insertError } = await supabase
      .from('shots')
      .insert(allShots);

    if (insertError) {
      throw new Error(`Failed to insert shots: ${insertError.message}`);
    }

    // 6. UPDATE episode with shot_list metadata
    const shotListData = {
      generatedAt: new Date().toISOString(),
      totalShots: allShots.length,
      totalDuration,
      shotTypes,
      scenesProcessed: sceneResults.length,
      processingMethod: 'parallel-batches',
    };

    const { error: updateError } = await supabase
      .from('episodes')
      .update({
        shot_list: shotListData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.episodeId)
      .eq('version', data.version);

    if (updateError) {
      console.error('[Shot Generation] Failed to update episode:', updateError);
    }

    console.log(
      `[Shot Generation] Created ${allShots.length} shots across ${sceneResults.length} scenes`,
    );

    // Extract and save audioCues from each shot's veoPrompt (Stage 2 of audio generation)
    // This is analogous to how dialogueTiming works - LLM generates structured audio cues per shot
    try {
      let cumulativeTime = 0;
      const audioCueInserts: Array<{
        episode_id: string;
        scene_number: number;
        cue_type: 'sfx' | 'ambient' | 'music';
        prompt: string;
        start_offset_seconds: number;
        duration_seconds: number;
        is_loopable: boolean;
        status: string;
      }> = [];

      // Sort by sequence_number to calculate proper timeline offsets
      const sortedShots = [...allShots].sort(
        (a, b) => a.sequence_number - b.sequence_number,
      );

      for (const shot of sortedShots) {
        const veoPrompt = shot.generation_metadata?.veoPrompt;
        const audioCues = veoPrompt?.audioCues || [];

        for (const cue of audioCues) {
          audioCueInserts.push({
            episode_id: data.episodeId,
            scene_number: shot.scene_number,
            cue_type: cue.type,
            prompt: cue.prompt,
            start_offset_seconds: cumulativeTime + (cue.startOffset || 0),
            duration_seconds: cue.duration || shot.duration_seconds,
            is_loopable: cue.isLoopable ?? cue.type === 'ambient',
            status: 'pending',
          });
        }

        cumulativeTime += shot.duration_seconds;
      }

      if (audioCueInserts.length > 0) {
        const { error: audioCueError } = await supabase
          .from('audio_cues')
          .insert(audioCueInserts);

        if (audioCueError) {
          console.error(
            '[Shot Generation] Failed to insert audio cues:',
            audioCueError.message,
          );
        } else {
          console.log(
            `[Shot Generation] Created ${audioCueInserts.length} audio cues`,
          );
        }
      } else {
        console.log(
          '[Shot Generation] No structured audio cues found in shots',
        );
      }
    } catch (audioCueError) {
      // Log but don't fail the shot generation - audio cues are secondary
      console.error(
        '[Shot Generation] Audio cue extraction failed:',
        audioCueError,
      );
    }

    // Mark job as completed
    await markJobCompleted(supabase, data.episodeId, 'shot_list', {
      totalShots: allShots.length,
      scenesProcessed: sceneResults.length,
      totalDuration,
    });

    return {
      success: true,
      data: {
        totalShots: allShots.length,
        shotsCreated: allShots.length,
        metadata: {
          totalDuration,
          shotTypes,
          scenesProcessed: sceneResults.length,
        },
      },
    };
  } catch (error) {
    // Mark job as failed
    await markJobFailed(
      supabase,
      data.episodeId,
      'shot_list',
      error instanceof Error ? error.message : 'Unknown error',
    );
    throw error;
  }
}
