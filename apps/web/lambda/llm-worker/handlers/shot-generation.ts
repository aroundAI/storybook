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

    // 1. Fetch episode with screenplay
    const { data: episode, error: episodeError } = await supabase
        .from('episodes')
        .select(`
            id, title, version, screenplay_data, story_data,
            project:projects(id, account_id, metadata)
        `)
        .eq('id', data.episodeId)
        .single();

    if (episodeError || !episode) {
        throw new Error(`Episode not found: ${episodeError?.message}`);
    }

    const screenplayData = episode.screenplay_data as { scenes: ScreenplayScene[] } | null;
    if (!screenplayData?.scenes?.length) {
        throw new Error('Episode must have screenplay generated first');
    }

    const scenes = screenplayData.scenes;

    // 2. Fetch characters and locations for context
    const [charactersResult, locationsResult] = await Promise.all([
        supabase
            .from('assets')
            .select('id, name, description, metadata')
            .eq('project_id', data.projectId)
            .eq('type', 'character')
            .is('deleted_at', null),
        supabase
            .from('assets')
            .select('id, name, description, metadata')
            .eq('project_id', data.projectId)
            .eq('type', 'location')
            .is('deleted_at', null),
    ]);

    const characters = charactersResult.data || [];
    const locations = locationsResult.data || [];

    // Format for prompts
    const formatCharacters = () => {
        if (characters.length === 0) return 'No characters defined.';
        return characters.map(c => {
            const meta = c.metadata as Record<string, unknown> || {};
            const attrs = [];
            if (meta.age) attrs.push(`Age: ${meta.age}`);
            if (meta.ethnicity) attrs.push(`Ethnicity: ${meta.ethnicity}`);
            if (meta.hairColor) attrs.push(`Hair: ${meta.hairColor}`);
            if (meta.build) attrs.push(`Build: ${meta.build}`);
            return `${c.name}: ${c.description || ''}${attrs.length ? ` [${attrs.join(', ')}]` : ''}`;
        }).join('\n');
    };

    const formatLocations = () => {
        if (locations.length === 0) return 'No locations defined.';
        return locations.map(l => `${l.name}: ${l.description || ''}`).join('\n');
    };

    const projectMetadata = (episode.project?.metadata as Record<string, unknown>) || {};
    const storyData = (episode.story_data as Record<string, unknown>) || {};

    const episodeMetadata = JSON.stringify({
        title: episode.title,
        genre: projectMetadata.genre || 'general',
        targetAudience: projectMetadata.targetAudience || 'general',
        visualStyle: projectMetadata.videoStyle || 'cinematic',
        tone: storyData.tone || 'balanced',
    });

    // 3. Process scenes in parallel batches
    const { executeLLM } = await import('@kit/prompt-engine/server');
    const sceneResults: SceneResult[] = [];

    for (let batchStart = 0; batchStart < scenes.length; batchStart += PARALLEL_CONCURRENCY) {
        const batch = scenes.slice(batchStart, batchStart + PARALLEL_CONCURRENCY);

        console.log(`[Shot Generation] Processing scenes ${batchStart + 1}-${Math.min(batchStart + PARALLEL_CONCURRENCY, scenes.length)}`);

        const batchPromises = batch.map(async (scene, batchIndex) => {
            const sceneNumber = scene.number || (batchStart + batchIndex + 1);

            const sceneContent = JSON.stringify({
                number: sceneNumber,
                heading: scene.heading,
                location: scene.location,
                timeOfDay: scene.timeOfDay,
                description: scene.description,
                action: scene.action,
                dialogue: scene.dialogue,
            });

            try {
                const result = await executeLLM<{ shots: GeneratedShot[]; sceneSummary: string }>({
                    templateSlug: 'scene-shot-generation',
                    variables: {
                        scene_number: sceneNumber,
                        total_scenes: scenes.length,
                        characters: formatCharacters(),
                        locations: formatLocations(),
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
                });

                return {
                    sceneNumber,
                    shots: result.data.shots,
                    sceneSummary: result.data.sceneSummary,
                };
            } catch (error) {
                console.error(`[Shot Generation] Scene ${sceneNumber} failed:`, error);
                return { sceneNumber, shots: [], sceneSummary: '' };
            }
        });

        const batchResults = await Promise.all(batchPromises);
        sceneResults.push(...batchResults);
    }

    // Sort by scene number
    sceneResults.sort((a, b) => a.sceneNumber - b.sceneNumber);

    // 4. Aggregate shots with global sequence numbers
    let sequenceNumber = 1;
    const allShots: Array<{
        episode_id: string;
        scene_number: number;
        shot_number: number;
        description: string;
        prompt: string;
        duration_seconds: number;
        camera_direction: string;
        characters: string[];
        status: string;
        metadata: Record<string, unknown>;
    }> = [];

    const shotTypes = { wide: 0, medium: 0, closeUp: 0 };
    let totalDuration = 0;

    for (const sceneResult of sceneResults) {
        for (const shot of sceneResult.shots) {
            allShots.push({
                episode_id: data.episodeId,
                scene_number: sceneResult.sceneNumber,
                shot_number: shot.shotNumber,
                description: shot.description,
                prompt: shot.veoPrompt?.fullPrompt || shot.description,
                duration_seconds: shot.duration,
                camera_direction: shot.cameraDirection,
                characters: shot.characters,
                status: 'pending',
                metadata: {
                    sequenceNumber: sequenceNumber++,
                    shotType: shot.shotType,
                    location: shot.metadata.location,
                    timeOfDay: shot.metadata.timeOfDay,
                    mood: shot.metadata.mood,
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

    console.log(`[Shot Generation] Created ${allShots.length} shots across ${sceneResults.length} scenes`);

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
}
