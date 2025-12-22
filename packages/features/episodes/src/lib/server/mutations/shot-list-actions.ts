'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { executeLLM } from '@kit/prompt-engine/server';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Import context builder functions
import {
  type GlobalShotContext,
  type SceneFilteredContext,
  buildGlobalShotContext,
  extractSceneCharacters,
  filterContextForScene,
  formatFilteredCharactersForPrompt,
  formatFilteredLocationsForPrompt,
  formatSceneForPrompt,
} from '../../../server/context-builder';
import {
  GenerateShotListSchema,
  type SceneShotGenerationOutput,
} from '../../schemas/shot-list.schema';
import type {
  BatchShotDefinition,
  CameraDirection,
} from '../../schemas/shot.schema';
import type {
  GenerateShotListResponse,
  ScreenplayData,
  ScreenplayScene,
  ShotListData,
} from '../../types';
import { batchCreateShotsAction } from './shot-actions';

/**
 * Maximum number of retry attempts for a failed scene
 */
const MAX_SCENE_RETRIES = 2;

/**
 * Number of scenes to process in parallel
 * Higher values = faster generation but more concurrent API calls
 */
const PARALLEL_SCENE_CONCURRENCY = 10;

/**
 * Delay helper for retry backoff
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse timestamp string "MM:SS" to seconds
 */
function parseTimeToSeconds(time: string): number {
  const [minutes, seconds] = time.split(':').map(Number);
  return (minutes || 0) * 60 + (seconds || 0);
}

/**
 * Result from generating shots for a single scene
 */
interface SceneGenerationResult {
  sceneNumber: number;
  shots: SceneShotGenerationOutput['shots'];
  sceneSummary: string;
}

/**
 * Generate shots for a single scene with filtered context
 * Only passes characters/locations that appear in this specific scene
 */
async function generateShotsForScene(params: {
  scene: ScreenplayScene;
  sceneNumber: number;
  totalScenes: number;
  globalContext: GlobalShotContext;
  previousSceneSummary: string;
  accountId: string;
  userId: string;
}): Promise<SceneGenerationResult> {
  const {
    scene,
    sceneNumber,
    totalScenes,
    globalContext,
    previousSceneSummary,
    accountId,
    userId,
  } = params;

  const logger = await getLogger();

  // Filter context to scene-relevant entities only (50-80% token savings)
  const sceneContext: SceneFilteredContext = filterContextForScene(
    scene,
    globalContext,
  );

  // Log if characters in dialogue aren't in registry (edge case)
  const dialogueCharacters = extractSceneCharacters(scene);
  const missingCharacters = dialogueCharacters.filter(
    (name) =>
      !sceneContext.characters.some(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
      ),
  );
  if (missingCharacters.length > 0) {
    logger.warn(
      { name: 'shot-list.scene', sceneNumber, missingCharacters },
      'Characters in dialogue not found in registry',
    );
  }

  // Format filtered registries for prompt
  const charactersText = formatFilteredCharactersForPrompt(
    sceneContext,
    dialogueCharacters,
  );
  const locationsText = formatFilteredLocationsForPrompt(
    sceneContext,
    scene.location,
  );
  const metadataText = JSON.stringify(sceneContext.episodeMetadata, null, 2);
  const sceneContent = formatSceneForPrompt(scene);

  // Execute LLM for this scene
  const result = await executeLLM<SceneShotGenerationOutput>({
    templateSlug: 'scene-shot-generation',
    variables: {
      scene_number: sceneNumber,
      total_scenes: totalScenes,
      characters: charactersText,
      locations: locationsText,
      episode_metadata: metadataText,
      previous_scene_summary: previousSceneSummary,
      scene_content: sceneContent,
    },
    context: {
      name: `shot-list.scene-${sceneNumber}`,
      accountId,
      userId,
    },
    temperature: 0.4,
  });

  return {
    sceneNumber,
    shots: result.data.shots,
    sceneSummary: result.data.sceneSummary,
  };
}

/**
 * Generate shots for a single scene with retry logic
 * Wraps generateShotsForScene with exponential backoff retry
 */
async function generateShotsForSceneWithRetry(params: {
  scene: ScreenplayScene;
  sceneNumber: number;
  totalScenes: number;
  globalContext: GlobalShotContext;
  accountId: string;
  userId: string;
}): Promise<SceneGenerationResult> {
  const { scene, sceneNumber, totalScenes, globalContext, accountId, userId } =
    params;

  const logger = await getLogger();
  const ctx = { name: 'shot-list.scene', sceneNumber };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_SCENE_RETRIES; attempt++) {
    try {
      const result = await generateShotsForScene({
        scene,
        sceneNumber,
        totalScenes,
        globalContext,
        previousSceneSummary: 'Context from parallel processing.', // No inter-scene context in parallel mode
        accountId,
        userId,
      });

      if (attempt > 0) {
        logger.info(
          { ...ctx, attempt: attempt + 1 },
          'Scene succeeded after retry',
        );
      }

      return result;
    } catch (sceneError) {
      lastError = sceneError as Error;
      const errorMessage =
        sceneError instanceof Error ? sceneError.message : String(sceneError);

      if (attempt < MAX_SCENE_RETRIES) {
        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = 1000 * Math.pow(2, attempt);

        logger.warn(
          {
            ...ctx,
            attempt: attempt + 1,
            maxRetries: MAX_SCENE_RETRIES,
            backoffMs,
            error: errorMessage,
          },
          'Scene generation failed, retrying...',
        );

        await delay(backoffMs);
        continue;
      }

      // All retries exhausted
      logger.error(
        {
          ...ctx,
          totalAttempts: MAX_SCENE_RETRIES + 1,
          error: errorMessage,
        },
        'Scene generation failed after all retries',
      );
    }
  }

  throw new Error(
    `Scene ${sceneNumber} failed after ${MAX_SCENE_RETRIES + 1} attempts: ${lastError?.message ?? 'Unknown error'}`,
  );
}

/**
 * Generated shot type for aggregation (matches GeneratedShot interface)
 */
interface AggregatedShot {
  sequenceNumber: number;
  sceneNumber: number;
  shotNumber: number;
  shotType: string;
  cameraDirection: string;
  description: string;
  action: string;
  prompt: string;
  characters: string[];
  duration: number;
  metadata: {
    location: string;
    timeOfDay: string;
    mood?: string;
    lighting?: string;
  };
  veoPrompt?: {
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
  };
  dialogueTiming?: Array<{
    startSeconds: number;
    durationSeconds: number;
    characterName: string;
    text: string;
    emotion: string | null;
  }>;
}

/**
 * Aggregate all scene results into unified shot list
 * Assigns global sequence numbers and collects reference images
 */
function aggregateSceneResults(
  sceneResults: SceneGenerationResult[],
  globalContext: GlobalShotContext,
): {
  generatedShots: AggregatedShot[];
  shotsToCreate: BatchShotDefinition[];
  totalShots: number;
  metadata: {
    totalShots: number;
    totalDuration: number;
    shotTypes: { wide: number; medium: number; closeUp: number };
    locations: string[];
    characters: string[];
  };
} {
  let sequenceNumber = 1;
  const allShots: AggregatedShot[] = [];
  const shotsToCreate: BatchShotDefinition[] = [];

  // Stats
  const shotTypes = { wide: 0, medium: 0, closeUp: 0 };
  const allLocations = new Set<string>();
  const allCharacters = new Set<string>();
  let totalDuration = 0;

  for (const sceneResult of sceneResults) {
    for (const shot of sceneResult.shots) {
      // Derive action from timeline events (concatenate action content)
      const derivedAction = shot.veoPrompt.timeline
        .filter((event) => event.type === 'action')
        .map((event) => event.content)
        .join(' ');

      // Assign global sequence number
      const sequencedShot: AggregatedShot = {
        ...shot,
        sequenceNumber: sequenceNumber++,
        sceneNumber: sceneResult.sceneNumber,
        action: derivedAction || shot.description,
        prompt: shot.veoPrompt.fullPrompt,
      };

      allShots.push(sequencedShot);

      // Get reference images for this shot's characters/locations
      const shotCharacterImages =
        globalContext.referenceImages.characters.filter((img) =>
          shot.characters.some(
            (c) => c.toLowerCase() === img.name.toLowerCase(),
          ),
        );
      const shotLocationImages = globalContext.referenceImages.locations.filter(
        (img) =>
          shot.metadata.location
            ?.toLowerCase()
            .includes(img.name.toLowerCase()),
      );

      // Derive dialogue timing from timeline dialogue events
      const dialogueTiming = shot.veoPrompt.timeline
        .filter((event) => event.type === 'dialogue' && event.character)
        .map((event) => ({
          startSeconds: parseTimeToSeconds(event.startTime),
          durationSeconds:
            parseTimeToSeconds(event.endTime) -
            parseTimeToSeconds(event.startTime),
          characterName: event.character || 'Unknown',
          text: event.content,
          emotion: event.emotion || null,
        }));

      // Prepare for batch creation
      // Cast cameraDirection to CameraDirection type (validated by LLM output schema)
      shotsToCreate.push({
        sceneNumber: sceneResult.sceneNumber,
        shotNumber: shot.shotNumber,
        description: shot.description,
        prompt: shot.veoPrompt.fullPrompt,
        durationSeconds: shot.duration,
        cameraDirection: shot.cameraDirection as CameraDirection,
        characters: shot.characters,
        metadata: {
          location: shot.metadata.location,
          timeOfDay: shot.metadata.timeOfDay,
          mood: shot.metadata.mood,
          shotType: shot.shotType,
          action: derivedAction,
          veoPrompt: shot.veoPrompt,
          referenceImages:
            shotCharacterImages.length > 0 || shotLocationImages.length > 0
              ? {
                characters: shotCharacterImages,
                locations: shotLocationImages,
              }
              : undefined,
          dialogueTiming: dialogueTiming.length > 0 ? dialogueTiming : undefined,
        },
      });

      // Aggregate stats
      if (shot.shotType === 'wide') shotTypes.wide++;
      else if (shot.shotType === 'medium') shotTypes.medium++;
      else if (shot.shotType?.includes('close')) shotTypes.closeUp++;

      if (shot.metadata.location) allLocations.add(shot.metadata.location);
      shot.characters.forEach((c) => allCharacters.add(c));
      totalDuration += shot.duration;
    }
  }

  return {
    generatedShots: allShots,
    shotsToCreate,
    totalShots: allShots.length,
    metadata: {
      totalShots: allShots.length,
      totalDuration,
      shotTypes,
      locations: Array.from(allLocations),
      characters: Array.from(allCharacters),
    },
  };
}

/**
 * Generates a shot list from an episode's screenplay using parallel scene processing
 * This approach scales to any screenplay length by processing scenes in parallel batches
 * with filtered context (only characters/locations appearing in each scene).
 *
 * Processes PARALLEL_SCENE_CONCURRENCY scenes at a time (default: 10) to balance
 * speed and API rate limits. Each scene has independent retry logic with exponential backoff.
 */
export const generateShotListAction = enhanceAction(
  async (data): Promise<GenerateShotListResponse> => {
    const logger = await getLogger();
    const ctx = { name: 'shot-list.generate', episodeId: data.episodeId };
    const startTime = Date.now();

    logger.info(ctx, 'Starting scene-by-scene shot list generation');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized shot list generation attempt');
      throw new Error('Authentication required');
    }

    // 1. BUILD GLOBAL CONTEXT (once) - contains all characters, locations, metadata
    const globalContext = await buildGlobalShotContext(data.episodeId);

    logger.info(
      {
        ...ctx,
        characterCount: globalContext.characterRegistry.length,
        locationCount: globalContext.locationRegistry.length,
      },
      'Built global context for scene processing',
    );

    // Fetch episode with screenplay_data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: episodeError } = await (client as any)
      .from('episodes')
      .select(
        'id, project_id, screenplay_data, story_data, status, version, title',
      )
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (episodeError || !episode) {
      logger.error({ ...ctx, error: episodeError }, 'Episode not found');
      throw new Error('Episode not found');
    }

    // 2. GET SCREENPLAY SCENES
    const screenplayData = episode.screenplay_data as ScreenplayData | null;

    if (!screenplayData?.scenes?.length) {
      throw new Error(
        'Episode must have screenplay with scenes generated first',
      );
    }

    const scenes = screenplayData.scenes;
    const totalScenes = scenes.length;

    logger.info(
      {
        ...ctx,
        sceneCount: totalScenes,
        concurrency: PARALLEL_SCENE_CONCURRENCY,
      },
      'Processing scenes in parallel batches',
    );

    // Get project for account context (needed for LLM analytics)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: project } = await (client as any)
      .from('projects')
      .select('account_id')
      .eq('id', episode.project_id)
      .single();

    const accountId = project?.account_id ?? 'unknown';

    // 3. PROCESS SCENES IN PARALLEL BATCHES
    // Each scene gets filtered context containing only its characters/locations
    // Process PARALLEL_SCENE_CONCURRENCY scenes at a time to avoid rate limiting
    const sceneResults: SceneGenerationResult[] = [];

    for (
      let batchStart = 0;
      batchStart < scenes.length;
      batchStart += PARALLEL_SCENE_CONCURRENCY
    ) {
      const batch = scenes.slice(
        batchStart,
        batchStart + PARALLEL_SCENE_CONCURRENCY,
      );
      const batchEnd = Math.min(
        batchStart + PARALLEL_SCENE_CONCURRENCY,
        scenes.length,
      );

      logger.info(
        {
          ...ctx,
          batchStart: batchStart + 1,
          batchEnd,
          batchSize: batch.length,
          totalScenes,
        },
        'Processing scene batch',
      );

      // Process batch in parallel
      const batchPromises = batch.map((scene, batchIndex) => {
        const sceneIndex = batchStart + batchIndex;
        const sceneNumber = scene.number ?? sceneIndex + 1;

        return generateShotsForSceneWithRetry({
          scene,
          sceneNumber,
          totalScenes,
          globalContext,
          accountId,
          userId: user.id,
        });
      });

      // Wait for all scenes in batch to complete
      const batchResults = await Promise.all(batchPromises);
      sceneResults.push(...batchResults);

      const batchShotCount = batchResults.reduce(
        (sum, r) => sum + r.shots.length,
        0,
      );

      logger.info(
        {
          ...ctx,
          batchStart: batchStart + 1,
          batchEnd,
          scenesCompleted: batchResults.length,
          shotsGenerated: batchShotCount,
        },
        'Completed scene batch',
      );
    }

    // Sort results by scene number to maintain order
    sceneResults.sort((a, b) => a.sceneNumber - b.sceneNumber);

    // 4. AGGREGATE RESULTS (Reduce)
    // Assigns global sequence numbers and collects reference images
    const aggregated = aggregateSceneResults(sceneResults, globalContext);

    if (aggregated.totalShots === 0) {
      throw new Error('No shots were generated from any scene');
    }

    logger.info(
      {
        ...ctx,
        totalShots: aggregated.totalShots,
        totalDuration: aggregated.metadata.totalDuration,
      },
      'Aggregated all scene results',
    );

    // 5. STORE SHOTS IN DATABASE
    const batchResult = await batchCreateShotsAction({
      episodeId: data.episodeId,
      shots: aggregated.shotsToCreate,
    });

    if (!batchResult.success) {
      throw new Error('Failed to create shot records');
    }

    // 6. PREPARE SHOT_LIST METADATA FOR EPISODE
    const shotListData: ShotListData = {
      shots: aggregated.generatedShots.map((shot) => ({
        sequenceNumber: shot.sequenceNumber,
        sceneNumber: shot.sceneNumber,
        duration: shot.duration,
        sceneDescription: shot.description,
        actionDescription: shot.action,
        prompt: shot.veoPrompt?.fullPrompt ?? shot.prompt,
        cameraDirection: shot.cameraDirection,
        characters: shot.characters,
        veoPrompt: shot.veoPrompt,
        dialogueTiming: shot.dialogueTiming,
      })),
      generatedAt: new Date().toISOString(),
      approvedAt: null,
      totalEstimatedDuration: aggregated.metadata.totalDuration,
      generatedBy: {
        model: 'deepseek-chat', // From scene-shot-generation.json template
        provider: 'deepseek',
        costCents: 0, // Aggregate cost tracking TODO
      },
      metadata: {
        totalShots: aggregated.metadata.totalShots,
        shotTypes: aggregated.metadata.shotTypes,
        locations: aggregated.metadata.locations,
        characters: aggregated.metadata.characters,
        inputSource: 'screenplay',
        processingMethod: 'parallel-batches',
        referenceImages: globalContext.referenceImages,
        scenesProcessed: totalScenes,
        scenesSuccessful: sceneResults.filter((r) => r.shots.length > 0).length,
      },
    };

    // 7. UPDATE EPISODE WITH SHOT_LIST
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedEpisode, error: updateError } = await (client as any)
      .from('episodes')
      .update({
        shot_list: shotListData as Json,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.episodeId)
      .eq('version', episode.version)
      .select('id, status, version')
      .single();

    if (updateError) {
      logger.error(
        { ...ctx, error: updateError },
        'Failed to update episode with shot list',
      );
      throw new Error(`Failed to update episode: ${updateError.message}`);
    }

    if (!updatedEpisode) {
      throw new Error('Episode was modified by another user');
    }

    const duration = Date.now() - startTime;

    logger.info(
      {
        ...ctx,
        duration,
        shotCount: aggregated.totalShots,
        shotsCreated: batchResult.count,
        scenesProcessed: totalScenes,
        processingMethod: 'parallel-batches',
      },
      'Shot list generation completed',
    );

    revalidatePath('/home/[account]/projects/[id]', 'page');

    return {
      success: true,
      shots: aggregated.generatedShots,
      shotsCreated: batchResult.count,
      metadata: {
        totalShots: aggregated.metadata.totalShots,
        totalDuration: aggregated.metadata.totalDuration,
        shotTypes: aggregated.metadata.shotTypes,
        locations: aggregated.metadata.locations,
        characters: aggregated.metadata.characters,
        processingMethod: 'parallel-batches',
      },
    };
  },
  { schema: GenerateShotListSchema },
);
