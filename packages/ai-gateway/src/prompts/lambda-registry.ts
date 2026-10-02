/**
 * The embedded prompt registry the Lambda executor reads (moved from
 * apps/web/lambda/llm-worker/prompt-registry.ts in FILM-1902 part B, with the
 * executor it serves). The prompts are imported at build time, so neither
 * the worker bundle nor the Next server reads the file system; keys are the
 * slugs handlers pass as `templateSlug`, with the nested aliases they use.
 */
import insightsGeneration from '@kit/prompt-engine/prompts/analytics/insights-generation.json';
import languageInsights from '@kit/prompt-engine/prompts/analytics/language-insights.json';
import dialogueTranslation from '@kit/prompt-engine/prompts/audio-generation/dialogue-translation.json';
import canonExtraction from '@kit/prompt-engine/prompts/canon-roles/canon-extraction.json';
import batchTranslateMetadata from '@kit/prompt-engine/prompts/publishing/batch-translate-metadata.json';
import extractAssetDescription from '@kit/prompt-engine/prompts/story-generation/extract-asset-description.json';
import sceneShot from '@kit/prompt-engine/prompts/story-generation/scene-shot-generation.json';
import screenplay from '@kit/prompt-engine/prompts/story-generation/screenplay-conversion.json';
import screenplayRefinement from '@kit/prompt-engine/prompts/story-generation/screenplay-refinement.json';
import season from '@kit/prompt-engine/prompts/story-generation/season-generation.json';
import seasonOutline from '@kit/prompt-engine/prompts/story-generation/season-outline.json';
import storyGen from '@kit/prompt-engine/prompts/story-generation/story-generation.json';
import storyIdeation from '@kit/prompt-engine/prompts/story-generation/story-ideation.json';
import storyRefinement from '@kit/prompt-engine/prompts/story-generation/story-refinement.json';
import {
  type RenderableTemplate,
  assertPromptLlm,
  renderTemplate,
} from '@kit/prompt-engine/render-template';

export interface LambdaPromptTemplate extends RenderableTemplate {
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
    // Not read by the executor. Most prompts carry a zod definition; some
    // (extract-asset-description, batch-translate-metadata) a JSON Schema.
    schema?: { type: 'zod'; definition: string } | Record<string, unknown>;
  };
}

/** The worker's name for the type, kept for its re-export. */
export type PromptTemplate = LambdaPromptTemplate;

export const PROMPT_REGISTRY: Record<string, LambdaPromptTemplate> = {
  // Story Generation
  'season-generation': season as LambdaPromptTemplate,
  'season-outline': seasonOutline as LambdaPromptTemplate,
  'story-ideation': storyIdeation as LambdaPromptTemplate,
  'story-generation': storyGen as LambdaPromptTemplate,
  'screenplay-conversion': screenplay as LambdaPromptTemplate,
  'story-refinement': storyRefinement as LambdaPromptTemplate,
  'screenplay-refinement': screenplayRefinement as LambdaPromptTemplate,

  'scene-shot-generation': sceneShot as LambdaPromptTemplate,
  // Nested slug aliases (story-generation/xyz)
  'story-generation/season-generation': season as LambdaPromptTemplate,
  'story-generation/season-outline': seasonOutline as LambdaPromptTemplate,
  'story-generation/story-ideation': storyIdeation as LambdaPromptTemplate,
  'story-generation/story-generation': storyGen as LambdaPromptTemplate,
  'story-generation/screenplay-conversion': screenplay as LambdaPromptTemplate,
  'story-generation/story-refinement': storyRefinement as LambdaPromptTemplate,
  'story-generation/screenplay-refinement':
    screenplayRefinement as LambdaPromptTemplate,
  'extract-asset-description': extractAssetDescription as LambdaPromptTemplate,
  'story-generation/extract-asset-description':
    extractAssetDescription as LambdaPromptTemplate,

  'story-generation/scene-shot-generation': sceneShot as LambdaPromptTemplate,
  // Analytics
  'insights-generation': insightsGeneration as LambdaPromptTemplate,
  'analytics-insights': insightsGeneration as LambdaPromptTemplate, // alias
  'language-insights': languageInsights as LambdaPromptTemplate,
  'analytics/insights-generation': insightsGeneration as LambdaPromptTemplate,
  'analytics/language-insights': languageInsights as LambdaPromptTemplate,
  // Publishing
  'batch-translate-metadata': batchTranslateMetadata as LambdaPromptTemplate,
  'publishing/batch-translate-metadata':
    batchTranslateMetadata as LambdaPromptTemplate,
  // Audio Generation
  'dialogue-translation': dialogueTranslation as LambdaPromptTemplate,
  'translate-dialogue': dialogueTranslation as LambdaPromptTemplate, // alias
  'audio-generation/dialogue-translation':
    dialogueTranslation as LambdaPromptTemplate,
  // Canon Roles (FILM-1101)
  'canon-extraction': canonExtraction as LambdaPromptTemplate,
  'canon-roles/canon-extraction': canonExtraction as LambdaPromptTemplate,
};

export function getPromptTemplate(slug: string): LambdaPromptTemplate {
  const template = PROMPT_REGISTRY[slug];
  if (!template) {
    throw new Error(
      `Prompt template not found: ${slug}. Available: ${Object.keys(PROMPT_REGISTRY).join(', ')}`,
    );
  }
  return template;
}

export interface RenderedLambdaPrompt {
  templateSlug: string;
  version: string;
  systemPrompt: string;
  userPrompt: string;
  llmConfig: LambdaPromptTemplate['llm'];
  output?: NonNullable<LambdaPromptTemplate['output']>;
}

/**
 * Renders a template with the same rule as prompt-engine (KB-126): an
 * unfilled or undeclared placeholder is an error, not blanked out.
 */
export function renderPrompt(
  template: LambdaPromptTemplate,
  variables: Record<string, unknown>,
): RenderedLambdaPrompt {
  assertPromptLlm(template.slug || template.name || 'unknown', template);

  const { systemPrompt, userPrompt } = renderTemplate(
    template.slug || template.name || 'unknown',
    template,
    variables,
  );

  return {
    templateSlug: template.name || template.slug || 'unknown',
    version: String(template.version || '1'),
    systemPrompt,
    userPrompt,
    llmConfig: template.llm,
    output: template.output,
  };
}

export function loadAndRenderPromptForLambda(
  slug: string,
  variables: Record<string, unknown>,
): RenderedLambdaPrompt {
  return renderPrompt(getPromptTemplate(slug), variables);
}
