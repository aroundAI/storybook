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
    markJobProcessing,
    markJobCompleted,
    markJobFailed,
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

    console.log(`[Screenplay Conversion] Processing for episode ${data.episodeId}`);

    // Mark job as processing
    await markJobProcessing(supabase, data.episodeId, 'screenplay');

    try {
        // 1. Fetch episode with story data
        const { data: episode, error: episodeError } = await supabase
            .from('episodes')
            .select(`
            id, number, title, version, status, story_data, target_duration_seconds,
            project:projects(id, account_id, metadata)
        `)
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
        } = await import('../utils/context-builder');

        const episodeContext = await buildEpisodeContext(data.episodeId, supabase);
        const characters = episodeContext.characters;
        const locations = episodeContext.locations;

        const charactersFormatted = formatCharactersForPrompt(characters);
        const _locationsFormatted = formatLocationsForPrompt(locations);

        console.log(`[Screenplay Conversion] Episode context: ${characters.length} characters, ${locations.length} locations`);

        const projectMetadata = (episode.project?.metadata as Record<string, unknown>) || {};

        // Import content scaling utilities from local Lambda utils (avoids server-only issues)
        const { calculateContentScaling, formatDuration } = await import('../utils/duration-scaling');
        type ContentStyle = 'dialogue-heavy' | 'action-heavy' | 'balanced';

        // Get target duration and content style
        const targetDuration = episode.target_duration_seconds || storyData.targetDuration || 300;
        const contentStyle = (data.contentStyle || storyData.contentStyle || 'dialogue-heavy') as ContentStyle;

        // Calculate scene and dialogue scaling based on duration
        const scaling = calculateContentScaling({
            targetDurationSeconds: targetDuration,
            contentStyle,
        });

        // Get character and location names for the prompt
        const characterNames = characters.map(c => c.name).join(', ') || 'No characters';
        const locationNames = locations.map(l => l.name).join(', ') || 'Various locations';

        // Average scene duration for prompt
        const avgSceneDuration = Math.round(targetDuration / ((scaling.screenplay.sceneCountMin + scaling.screenplay.sceneCountMax) / 2));

        const variables = {
            story: storyData.fullStory as string,
            characters: charactersFormatted || 'No characters defined.',
            character_names: characterNames,
            location_names: locationNames,
            target_duration: targetDuration,
            duration_description: formatDuration(targetDuration),
            content_style: contentStyle,
            scene_count_min: scaling.screenplay.sceneCountMin,
            scene_count_max: scaling.screenplay.sceneCountMax,
            avg_scene_duration: avgSceneDuration,
            dialogue_lines_per_scene_min: scaling.screenplay.dialogueLinesPerSceneMin,
            dialogue_lines_per_scene_max: scaling.screenplay.dialogueLinesPerSceneMax,
            total_dialogue_lines_min: scaling.screenplay.totalDialogueLinesMin,
            total_dialogue_lines_max: scaling.screenplay.totalDialogueLinesMax,
            style: data.dialogueStyle || 'natural',
            genre: projectMetadata.genre || 'general',
            target_audience: projectMetadata.targetAudience || 'general',
        };

        // 3. Execute LLM
        const { executeLLM } = await import('@kit/prompt-engine/server');

        const result = await executeLLM<ScreenplayOutput>({
            templateSlug: 'screenplay-conversion',
            variables,
            context: {
                name: 'screenplay-conversion',
                accountId: data.accountId,
                userId: data.userId,
            },
            supabaseClient: supabase,
        });

        const costCents = Math.ceil((result.metadata.cost ?? 0) * 100);
        const generatedAt = new Date().toISOString();

        // 4. Prepare screenplay_data with full metadata for episode header display
        // Extract unique locations from all scenes
        const uniqueLocations = [...new Set(
            result.data.screenplay.scenes
                .map(scene => scene.location)
                .filter((loc): loc is string => Boolean(loc))
        )];

        // Extract unique characters from all dialogue lines across all scenes
        const uniqueCharacters = [...new Set(
            result.data.screenplay.scenes
                .flatMap(scene => scene.dialogue || [])
                .map(line => line.character)
                .filter((char): char is string => Boolean(char))
        )];

        // Calculate total estimated duration from all scenes
        const totalEstimatedDuration = result.data.screenplay.scenes
            .reduce((sum, scene) => sum + (scene.estimatedDuration || 0), 0);

        const screenplayData = {
            scenes: result.data.screenplay.scenes,
            generatedAt,
            generatedBy: {
                model: result.metadata.model,
                provider: result.metadata.provider,
                costCents,
            },
            totalDialogueLines: result.data.screenplay.totalDialogueLines,
            estimatedDuration: result.data.screenplay.estimatedDuration,
            approvedAt: null,
            // Full metadata for episode header display
            metadata: {
                locations: uniqueLocations,
                characters: uniqueCharacters,
                totalScenes: result.data.screenplay.scenes.length,
                estimatedDuration: totalEstimatedDuration,
            },
        };

        // 5. UPDATE episode with screenplay_data
        const { data: updatedEpisode, error: updateError } = await supabase
            .from('episodes')
            .update({
                screenplay_data: screenplayData,
                status: 'storyboard',
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
            throw new Error('Episode was modified by another user');
        }

        // 6. Extract and INSERT dialogue lines
        // Create a character name to ID map
        const characterMap = new Map(
            (characters || []).map(c => [c.name.toLowerCase(), c.id])
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
        for (const scene of result.data.screenplay.scenes) {
            for (const line of scene.dialogue) {
                const characterId = characterMap.get(line.character.toLowerCase()) || null;
                dialogueLines.push({
                    episode_id: data.episodeId,
                    character_asset_id: characterId,
                    text: line.text,  // Fixed: prompt template uses 'text' not 'dialogue'
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
                console.error('[Screenplay Conversion] Failed to insert dialogue:', insertError);
                // Don't throw - screenplay was saved successfully
            }
        }

        console.log(`[Screenplay Conversion] Created ${result.data.screenplay.scenes.length} scenes, ${dialogueLines.length} dialogue lines`);

        // Mark job as completed
        await markJobCompleted(supabase, data.episodeId, 'screenplay', {
            model: result.metadata.model,
            provider: result.metadata.provider,
            costCents,
            scenesCreated: result.data.screenplay.scenes.length,
            dialogueLinesCreated: dialogueLines.length,
        });

        return {
            success: true,
            data: {
                screenplay: result.data.screenplay,
                dialogueLinesCreated: dialogueLines.length,
                episode: {
                    id: updatedEpisode.id,
                    status: updatedEpisode.status,
                    version: updatedEpisode.version,
                },
                metadata: {
                    provider: result.metadata.provider,
                    model: result.metadata.model,
                    costCents,
                    tokensUsed: result.metadata.tokens,
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
