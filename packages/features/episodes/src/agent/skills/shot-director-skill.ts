/**
 * Shot Director Skill
 *
 * Wraps shot generation as an agent-callable tool.
 * The Orchestrator calls this after the Reel Scout has identified
 * candidate scenes, so the Shot Director can prioritize hook-optimized
 * shot compositions for those scenes.
 *
 * Accepts:
 * - Screenplay scenes from the Screenplay Director
 * - VEO-formatted character context (formatCharactersForVeoPrompt)
 * - Reel candidate scene numbers from Reel Scout (for priority treatment)
 *
 * Returns:
 * - Structured shot list ready for DB insertion
 */

import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

const generateShotsTool = createTool({
    name: 'generateShots',
    description:
        'Generates a VEO 3.1 optimized shot list for all screenplay scenes. Processes scenes in parallel. Accepts reelCandidateScenes from Reel Scout to prioritize hook-optimized shot compositions for those scenes.',
    parameters: z.object({
        episodeTitle: z.string().describe('Episode title'),
        genre: z.string().describe('Content genre'),
        targetAudience: z.string().describe('Target audience'),
        visualStyle: z.string().describe('Visual/aesthetic style of the project'),
        characters: z
            .string()
            .describe(
                'VEO 3.1 formatted character context from formatCharactersForVeoPrompt — includes 15+ physical attributes per character.',
            ),
        locations: z
            .string()
            .describe('VEO 3.1 formatted location context'),
        scenes: z
            .array(
                z.object({
                    number: z.number(),
                    heading: z.string(),
                    location: z.string(),
                    timeOfDay: z.string(),
                    description: z.string(),
                    action: z.array(z.string()),
                    dialogue: z.array(
                        z.object({
                            character: z.string(),
                            text: z.string(),
                            parenthetical: z.string().optional(),
                        }),
                    ),
                    estimatedDuration: z.number().optional(),
                }),
            )
            .describe('All screenplay scenes to generate shots for'),
        reelCandidateScenes: z
            .array(z.number())
            .describe(
                'Scene numbers identified by Reel Scout as Reel candidates. Shot Director will prioritize hook/visual storytelling in these scenes.',
            ),
        tone: z.string().default('balanced').describe('Narrative tone'),
    }),
    execute: async ({
        episodeTitle,
        genre,
        targetAudience,
        visualStyle,
        characters,
        locations,
        scenes,
        reelCandidateScenes,
        tone,
    }) => {
        try {
            const { executeLLM } = await import('@kit/prompt-engine/server');

            // Process scenes in parallel batches of 5
            const CONCURRENCY = 5;
            const allShots: Array<{
                sceneNumber: number;
                shotNumber: number;
                shotType: string;
                cameraDirection: string;
                description: string;
                duration: number;
                characters: string[];
                veoPrompt: Record<string, unknown>;
                metadata: {
                    location: string;
                    timeOfDay: string;
                    mood?: string;
                    lighting?: string;
                };
            }> = [];

            for (let i = 0; i < scenes.length; i += CONCURRENCY) {
                const batch = scenes.slice(i, i + CONCURRENCY);

                const batchResults = await Promise.all(
                    batch.map(async (scene) => {
                        const isReelCandidate = reelCandidateScenes.includes(scene.number);

                        const sceneContent = JSON.stringify({
                            number: scene.number,
                            heading: scene.heading,
                            location: scene.location,
                            timeOfDay: scene.timeOfDay,
                            description: scene.description,
                            action: scene.action,
                            dialogue: scene.dialogue,
                        });

                        const episodeMetadata = JSON.stringify({
                            title: episodeTitle,
                            genre,
                            targetAudience,
                            visualStyle,
                            tone,
                        });

                        const reelNote = isReelCandidate
                            ? `PRIORITY: This scene is a Reel candidate. Lead with a high-impact visual hook in Shot 1. Use close-ups for emotional beats. Make the first 3 seconds grabby.`
                            : '';

                        const result = await executeLLM<{
                            shots: Array<{
                                shotNumber: number;
                                shotType: string;
                                cameraDirection: string;
                                description: string;
                                duration: number;
                                characters: string[];
                                veoPrompt: {
                                    shotLine: string;
                                    audio: string;
                                    style: string;
                                    avoid: string;
                                    fullPrompt: string;
                                };
                                metadata: {
                                    location: string;
                                    timeOfDay: string;
                                    mood?: string;
                                    lighting?: string;
                                };
                            }>;
                            sceneSummary: string;
                        }>({
                            templateSlug: 'story-generation/scene-shot-generation',
                            variables: {
                                scene_content: sceneContent,
                                episode_metadata: episodeMetadata,
                                characters_context: characters,
                                locations_context: locations,
                                reel_note: reelNote,
                            },
                            context: {
                                name: 'agent.shotDirector.generateShots',
                                accountId: '',
                            },
                        });

                        return result.data.shots.map((shot) => ({
                            ...shot,
                            sceneNumber: scene.number,
                        }));
                    }),
                );

                allShots.push(...batchResults.flat());
            }

            // Reassign global sequence numbers
            const shotsWithSequence = allShots.map((shot, idx) => ({
                ...shot,
                shotNumber: idx + 1,
            }));

            return toolSuccess({
                shots: shotsWithSequence,
                totalShots: shotsWithSequence.length,
                scenesProcessed: scenes.length,
                reelCandidatesOptimized: reelCandidateScenes.length,
                summary: `Generated ${shotsWithSequence.length} shots across ${scenes.length} scenes. ${reelCandidateScenes.length} scenes had hook-priority treatment.`,
            });
        } catch (error) {
            return toolError(
                `Shot Director failed: ${(error as Error).message}`,
            );
        }
    },
});

export const shotDirectorSkill: Skill = {
    name: 'shot-director',
    description:
        'Generates a VEO 3.1 optimized shot list for all screenplay scenes. Prioritizes hook-optimized shot compositions for scenes identified as Reel candidates by the Reel Scout.',
    tools: [generateShotsTool],
    contextPrompt: `You are the Shot Director — a visual production specialist for short-form video content.

You translate screenplay scenes into VEO 3.1 optimized shot lists:
- Each shot has a complete 7-component VEO prompt (subject, action, scene, style, dialogue, sounds, negative)
- For Reel candidate scenes: Shot 1 is always a hook shot (close-up or dramatic reveal)
- Character descriptions must match the VEO context provided EXACTLY — never invent attributes
- Use varied shot types: wide establishing, medium two-shot, close-up reaction, POV`,
    instructions: `1. Call generateShots with all screenplay scenes and the reelCandidateScenes list from Reel Scout
2. Pass the full VEO character context verbatim
3. Report totalShots and scenesProcessed to the Orchestrator
4. The Orchestrator will persist shots to the database`,
};
