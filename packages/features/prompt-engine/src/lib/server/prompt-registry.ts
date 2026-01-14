/**
 * Build-time Prompt Registry
 *
 * This module statically imports all prompt templates so they are bundled
 * at build time. This is necessary for AWS Lambda / serverless environments
 * where the filesystem structure differs from local development.
 *
 * When adding new prompts, add an import and registry entry here.
 */

import type { PromptTemplate } from '../types';

// =============================================================================
// Story Generation Prompts
// =============================================================================
import storyGeneration from '../../prompts/story-generation/story-generation.json';
import seasonGeneration from '../../prompts/story-generation/season-generation.json';
import seasonOutline from '../../prompts/story-generation/season-outline.json';
import screenplayConversion from '../../prompts/story-generation/screenplay-conversion.json';
import shotListGeneration from '../../prompts/story-generation/shot-list-generation.json';
import sceneShotGeneration from '../../prompts/story-generation/scene-shot-generation.json';
import storyIdeation from '../../prompts/story-generation/story-ideation.json';

// =============================================================================
// Analytics Prompts
// =============================================================================
import insightsGeneration from '../../prompts/analytics/insights-generation.json';
import languageInsights from '../../prompts/analytics/language-insights.json';

// =============================================================================
// Audio Generation Prompts
// =============================================================================
import dialogueTranslation from '../../prompts/audio-generation/dialogue-translation.json';

// =============================================================================
// Publishing Prompts
// =============================================================================
import translateMetadata from '../../prompts/publishing/translate-metadata.json';

/**
 * Registry of all bundled prompt templates
 *
 * Keys are the prompt slugs (filename without .json extension)
 * Values are the parsed JSON prompt templates
 */
export const PROMPT_REGISTRY: Record<string, PromptTemplate> = {
    // Story Generation
    'story-generation': storyGeneration as unknown as PromptTemplate,
    'season-generation': seasonGeneration as unknown as PromptTemplate,
    'season-outline': seasonOutline as unknown as PromptTemplate,
    'screenplay-conversion': screenplayConversion as unknown as PromptTemplate,
    'shot-list-generation': shotListGeneration as unknown as PromptTemplate,
    'scene-shot-generation': sceneShotGeneration as unknown as PromptTemplate,
    'story-ideation': storyIdeation as unknown as PromptTemplate,

    // Analytics
    'insights-generation': insightsGeneration as unknown as PromptTemplate,
    'language-insights': languageInsights as unknown as PromptTemplate,

    // Audio Generation
    'dialogue-translation': dialogueTranslation as unknown as PromptTemplate,

    // Publishing
    'translate-metadata': translateMetadata as unknown as PromptTemplate,
};

/**
 * Check if a prompt is available in the bundled registry
 */
export function isPromptInRegistry(slug: string): boolean {
    return slug in PROMPT_REGISTRY;
}

/**
 * Get a prompt from the bundled registry
 */
export function getPromptFromRegistry(slug: string): PromptTemplate | undefined {
    return PROMPT_REGISTRY[slug];
}
