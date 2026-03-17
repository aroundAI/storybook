/**
 * Quality Evaluation Skill
 *
 * LLM-based self-critique tools for evaluating generated content quality.
 * Uses a cheaper model (gpt-4o-mini) for cost-efficient evaluation.
 */

import { z } from 'zod';

import { createLLMClient } from '@kit/llm';
import type { LLMProvider } from '@kit/llm';

import type { Skill } from '../types';
import { createTool, toolError, toolSuccess } from '../tool';

// =============================================================================
// EVALUATION LLM CONFIG
// =============================================================================

/** Use a cheap model for quality evaluation to minimize costs */
const EVAL_PROVIDER: LLMProvider = 'openai';
const EVAL_MODEL = 'gpt-4o-mini';

function getEvalApiKey(): string {
    return process.env.OPENAI_API_KEY ?? '';
}

/**
 * Generic evaluation helper that calls the LLM for scoring.
 */
async function evaluateWithLLM(
    systemPrompt: string,
    content: string,
): Promise<{
    overallScore: number;
    dimensions: Record<string, number>;
    critique: string;
    strengths: string[];
    weaknesses: string[];
}> {
    const llm = createLLMClient({
        provider: EVAL_PROVIDER,
        model: EVAL_MODEL,
        apiKey: getEvalApiKey(),
    });

    const response = await llm.createChatCompletion({
        messages: [
            { role: 'system', content: systemPrompt },
            {
                role: 'user',
                content: `Evaluate the following content:\n\n${content}`,
            },
        ],
        temperature: 0.2,
        maxTokens: 1500,
    });

    const responseContent = response.message.content ?? '';

    // Extract JSON from response
    const jsonMatch = responseContent.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = jsonMatch?.[1] ?? responseContent;

    try {
        return JSON.parse(jsonStr.trim());
    } catch {
        // Fallback if JSON parsing fails
        return {
            overallScore: 0.5,
            dimensions: {},
            critique: responseContent,
            strengths: [],
            weaknesses: ['Could not parse evaluation response'],
        };
    }
}

// =============================================================================
// EVALUATION TOOLS
// =============================================================================

const STORY_EVAL_PROMPT = `You are a professional story editor. Evaluate the given story on these dimensions (score 0.0-1.0):

- plotCoherence: Is the plot logical and well-structured?
- tensionArc: Does tension rise and fall effectively?
- characterDevelopment: Are characters well-developed with clear motivations?
- dialogueNaturalism: Does dialogue sound natural and distinct per character?
- pacing: Is the story well-paced without dragging or rushing?

Respond with JSON:
\`\`\`json
{
  "overallScore": 0.0-1.0,
  "dimensions": { "plotCoherence": 0.0-1.0, "tensionArc": 0.0-1.0, ... },
  "critique": "1-2 sentence summary of biggest issues",
  "strengths": ["strength 1", ...],
  "weaknesses": ["weakness 1", ...]
}
\`\`\``;

const evaluateStoryQualityTool = createTool({
    name: 'evaluateStoryQuality',
    description:
        'Evaluates story quality on plot coherence, tension arc, character development, dialogue, and pacing. Returns a 0-1 score. Use this after generating a story to decide if it needs revision.',
    parameters: z.object({
        storyContent: z.string().describe('The story content to evaluate'),
    }),
    execute: async ({ storyContent }) => {
        try {
            const result = await evaluateWithLLM(STORY_EVAL_PROMPT, storyContent);
            return toolSuccess(result);
        } catch (error) {
            return toolError(
                `Story evaluation failed: ${(error as Error).message}`,
            );
        }
    },
});

const SCREENPLAY_EVAL_PROMPT = `You are a professional screenplay editor. Evaluate the given screenplay on these dimensions (score 0.0-1.0):

- sceneStructure: Are scenes well-structured with clear beginnings, middles, and ends?
- transitionQuality: Do scenes flow naturally into each other?
- dialogueTiming: Is dialogue well-timed with appropriate pauses and beats?
- visualDescriptions: Are visual descriptions cinematic and clear?
- sceneCount: Does the number of scenes match the target duration?

Respond with JSON:
\`\`\`json
{
  "overallScore": 0.0-1.0,
  "dimensions": { "sceneStructure": 0.0-1.0, ... },
  "critique": "1-2 sentence summary",
  "strengths": ["..."],
  "weaknesses": ["..."]
}
\`\`\``;

const evaluateScreenplayQualityTool = createTool({
    name: 'evaluateScreenplayQuality',
    description:
        'Evaluates screenplay quality on scene structure, transitions, dialogue timing, and visual descriptions. Returns a 0-1 score.',
    parameters: z.object({
        screenplayContent: z
            .string()
            .describe('The screenplay content to evaluate'),
        targetSceneCount: z
            .number()
            .optional()
            .describe('Expected number of scenes for the target duration'),
    }),
    execute: async ({ screenplayContent, targetSceneCount }) => {
        try {
            const content = targetSceneCount
                ? `${screenplayContent}\n\n[Target scene count: ${targetSceneCount}]`
                : screenplayContent;
            const result = await evaluateWithLLM(SCREENPLAY_EVAL_PROMPT, content);
            return toolSuccess(result);
        } catch (error) {
            return toolError(
                `Screenplay evaluation failed: ${(error as Error).message}`,
            );
        }
    },
});

const SHOT_EVAL_PROMPT = `You are a professional cinematographer and VFX supervisor evaluating VEO 3.1 shot prompts. Evaluate on these dimensions (score 0.0-1.0):

- veoCompliance: Does each shot have all 7 components (Subject, Action, Scene, Style, Dialogue, Sounds, Negative)?
- characterConsistency: Are character descriptions consistent across shots?
- shotDiversity: Is there variety in shot types, angles, and camera movements?
- visualContinuity: Does lighting, time-of-day, and environment stay consistent within scenes?

Respond with JSON:
\`\`\`json
{
  "overallScore": 0.0-1.0,
  "dimensions": { "veoCompliance": 0.0-1.0, ... },
  "critique": "1-2 sentence summary",
  "strengths": ["..."],
  "weaknesses": ["..."]
}
\`\`\``;

const evaluateShotQualityTool = createTool({
    name: 'evaluateShotQuality',
    description:
        'Evaluates shot list quality on VEO 3.1 compliance, character consistency, shot diversity, and visual continuity. Returns a 0-1 score.',
    parameters: z.object({
        shotsContent: z
            .string()
            .describe('The shot list content (JSON stringified) to evaluate'),
    }),
    execute: async ({ shotsContent }) => {
        try {
            const result = await evaluateWithLLM(SHOT_EVAL_PROMPT, shotsContent);
            return toolSuccess(result);
        } catch (error) {
            return toolError(
                `Shot evaluation failed: ${(error as Error).message}`,
            );
        }
    },
});

// =============================================================================
// SKILL EXPORT
// =============================================================================

/**
 * Quality Evaluation Skill
 *
 * Provides self-critique capabilities for generated content.
 * Uses gpt-4o-mini for cost-efficient evaluation (~$0.001 per call).
 */
export const qualityEvaluationSkill: Skill = {
    name: 'quality-evaluation',
    description:
        'Evaluates generated content quality on multiple dimensions using a separate LLM call. Provides scores, critique, strengths, and weaknesses.',
    tools: [
        evaluateStoryQualityTool,
        evaluateScreenplayQualityTool,
        evaluateShotQualityTool,
    ],
    contextPrompt: `You can evaluate content quality before accepting output.
Quality evaluation uses a separate, cheaper LLM call (gpt-4o-mini).
Quality threshold: 0.7 on a 0-1 scale.
Scores below 0.7 indicate the content needs revision.`,
    instructions: `1. After generating content, call the appropriate evaluation tool
2. If overallScore < 0.7, review the weaknesses and critique
3. Revise the content targeting the specific weak areas identified
4. Re-evaluate after revision (max 2 revision rounds)
5. Accept the content once score ≥ 0.7 or after 2 revision rounds`,
};
