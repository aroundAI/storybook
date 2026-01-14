/**
 * Screenplay Conversion Handler
 *
 * Converts a story to screenplay format and extracts dialogue lines.
 * WRITES TO DATABASE: 
 * - Updates episode.screenplay_data and status
 * - Inserts dialogue_lines
 */
import type { SupabaseClient } from '@supabase/supabase-js';

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

    // 2. Fetch characters for context
    const { data: characters } = await supabase
        .from('assets')
        .select('id, name, description, metadata')
        .eq('project_id', data.projectId)
        .eq('type', 'character')
        .is('deleted_at', null);

    const formatCharacters = (chars: typeof characters) => {
        if (!chars || chars.length === 0) return 'No characters defined.';
        return chars.map(c => {
            const meta = c.metadata as Record<string, unknown> || {};
            return `- ${c.name}: ${c.description || ''}${meta.personality ? ` (${meta.personality})` : ''}`;
        }).join('\n');
    };

    const projectMetadata = (episode.project?.metadata as Record<string, unknown>) || {};

    // Calculate estimated scene count from duration
    const targetDuration = episode.target_duration_seconds || storyData.targetDuration || 300;
    const estimatedSceneCount = Math.ceil(targetDuration / 30); // ~30 sec per scene

    const variables = {
        story: storyData.fullStory as string,
        characters: formatCharacters(characters || []),
        target_scene_count: estimatedSceneCount,
        dialogue_style: data.dialogueStyle || 'natural',
        content_style: data.contentStyle || storyData.contentStyle || 'balanced',
        format: 'standard',
        genre: projectMetadata.genre || 'general',
        target_audience: projectMetadata.targetAudience || 'general',
    };

    // 3. Execute LLM
    const { executeLLM } = await import('@kit/prompt-engine/server');

    const result = await executeLLM<ScreenplayOutput>({
        templateSlug: 'story-generation/screenplay-conversion',
        variables,
        context: {
            name: 'screenplay-conversion',
            accountId: data.accountId,
            userId: data.userId,
        },
    });

    const costCents = Math.ceil((result.metadata.cost ?? 0) * 100);
    const generatedAt = new Date().toISOString();

    // 4. Prepare screenplay_data
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
                text: line.dialogue,
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
}
