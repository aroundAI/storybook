/**
 * Embedded Prompt Registry for Lambda
 *
 * Since Lambda can't access file system paths from other packages,
 * we import the prompts at build time using esbuild's JSON loader.
 *
 * NOTE: These paths are relative from apps/web/lambda/llm-worker/
 */
// Story Generation Prompts
// Analytics Prompts (correct file names)
import insightsGeneration from '../../../../packages/features/prompt-engine/src/prompts/analytics/insights-generation.json';
import languageInsights from '../../../../packages/features/prompt-engine/src/prompts/analytics/language-insights.json';
// Audio Generation Prompts (correct file name)
import dialogueTranslation from '../../../../packages/features/prompt-engine/src/prompts/audio-generation/dialogue-translation.json';
// Canon Role Prompts (FILM-1101)
import canonExtraction from '../../../../packages/features/prompt-engine/src/prompts/canon-roles/canon-extraction.json';
// Publishing Prompts
import batchTranslateMetadata from '../../../../packages/features/prompt-engine/src/prompts/publishing/batch-translate-metadata.json';
import sceneShot from '../../../../packages/features/prompt-engine/src/prompts/story-generation/scene-shot-generation.json';
import screenplay from '../../../../packages/features/prompt-engine/src/prompts/story-generation/screenplay-conversion.json';
import season from '../../../../packages/features/prompt-engine/src/prompts/story-generation/season-generation.json';
import seasonOutline from '../../../../packages/features/prompt-engine/src/prompts/story-generation/season-outline.json';
import storyGen from '../../../../packages/features/prompt-engine/src/prompts/story-generation/story-generation.json';
import storyIdeation from '../../../../packages/features/prompt-engine/src/prompts/story-generation/story-ideation.json';

export interface PromptTemplate {
  slug?: string;
  name: string;
  version: string | number;
  description?: string;
  variables: Record<
    string,
    { type: string; required: boolean; default?: unknown }
  >;
  llm: {
    provider: string;
    model: string;
    max_tokens?: number;
    temperature?: number;
    response_format?: string | { type: string };
  };
  // Legacy format: single string
  system_prompt?: string;
  // New format: array of prompt objects
  system_prompts?: Array<{
    slug: string;
    name: string;
    content: string;
    layer_type?: string;
    scope?: string;
    order?: number;
  }>;
  user_prompt: string;
  output?: {
    type: 'array' | 'object' | 'text';
    wrapper_key?: string;
    schema_for_llm?: string;
    schema?: {
      type: 'zod';
      definition: string;
    };
  };
}

/**
 * Map of slug to prompt template
 * All prompts are embedded at build time
 */
export const PROMPT_REGISTRY: Record<string, PromptTemplate> = {
  // Story Generation
  'season-generation': season as PromptTemplate,
  'season-outline': seasonOutline as PromptTemplate,
  'story-ideation': storyIdeation as PromptTemplate,
  'story-generation': storyGen as PromptTemplate,
  'screenplay-conversion': screenplay as PromptTemplate,

  'scene-shot-generation': sceneShot as PromptTemplate,
  // Nested slug aliases (story-generation/xyz)
  'story-generation/season-generation': season as PromptTemplate,
  'story-generation/season-outline': seasonOutline as PromptTemplate,
  'story-generation/story-ideation': storyIdeation as PromptTemplate,
  'story-generation/story-generation': storyGen as PromptTemplate,
  'story-generation/screenplay-conversion': screenplay as PromptTemplate,

  'story-generation/scene-shot-generation': sceneShot as PromptTemplate,
  // Analytics
  'insights-generation': insightsGeneration as PromptTemplate,
  'analytics-insights': insightsGeneration as PromptTemplate, // alias
  'language-insights': languageInsights as PromptTemplate,
  'analytics/insights-generation': insightsGeneration as PromptTemplate,
  'analytics/language-insights': languageInsights as PromptTemplate,
  // Publishing
  'batch-translate-metadata': batchTranslateMetadata as PromptTemplate,
  'publishing/batch-translate-metadata':
    batchTranslateMetadata as PromptTemplate,
  // Audio Generation
  'dialogue-translation': dialogueTranslation as PromptTemplate,
  'translate-dialogue': dialogueTranslation as PromptTemplate, // alias
  'audio-generation/dialogue-translation':
    dialogueTranslation as PromptTemplate,
  // Canon Roles (FILM-1101)
  'canon-extraction': canonExtraction as PromptTemplate,
  'canon-roles/canon-extraction': canonExtraction as PromptTemplate,
};

/**
 * Get a prompt template by slug
 * Returns embedded prompt from registry
 */
export function getPromptTemplate(slug: string): PromptTemplate {
  const template = PROMPT_REGISTRY[slug];
  if (!template) {
    throw new Error(
      `Prompt template not found: ${slug}. Available: ${Object.keys(PROMPT_REGISTRY).join(', ')}`,
    );
  }
  return template;
}
