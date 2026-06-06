/**
 * Build-time Prompt Registry
 *
 * This module statically imports all prompt templates so they are bundled
 * at build time. This is necessary for AWS Lambda / serverless environments
 * where the filesystem structure differs from local development.
 *
 * When adding new prompts, add an import and registry entry here.
 */
// =============================================================================
// Analytics Prompts
// =============================================================================
import insightsGeneration from '../../prompts/analytics/insights-generation.json';
import languageInsights from '../../prompts/analytics/language-insights.json';
// =============================================================================
// Audio Generation Prompts
// =============================================================================
import dialogueTranslation from '../../prompts/audio-generation/dialogue-translation.json';
import sceneAudioRefinement from '../../prompts/audio-generation/scene-audio-refinement.json';
// =============================================================================
// Canon Roles Prompts
// =============================================================================
import canonExtraction from '../../prompts/canon-roles/canon-extraction.json';
// =============================================================================
// Documentary Prompts
// =============================================================================
import factCheckerRole from '../../prompts/documentary/fact-checker-role.json';
import factExtraction from '../../prompts/documentary/fact-extraction.json';
import researcherRole from '../../prompts/documentary/researcher-role.json';
// =============================================================================
// Movie Prompts
// =============================================================================
import actContextExtraction from '../../prompts/movie/act-context-extraction.json';
// =============================================================================
// News Generation Prompts
// =============================================================================
import anchorRole from '../../prompts/news-generation/anchor-role.json';
import entityExtraction from '../../prompts/news-generation/entity-extraction.json';
import producerRole from '../../prompts/news-generation/producer-role.json';
import topicSummary from '../../prompts/news-generation/topic-summary.json';
import batchTranslateMetadata from '../../prompts/publishing/batch-translate-metadata.json';
import linkedinPostGeneration from '../../prompts/publishing/linkedin-post-generation.json';
// =============================================================================
// Publishing Prompts
// =============================================================================

// =============================================================================
// Quality Evaluation Prompts
// =============================================================================
import reelScout from '../../prompts/quality-evaluation/reel-scout.json';
import screenplayQuality from '../../prompts/quality-evaluation/screenplay-quality.json';
import shotQuality from '../../prompts/quality-evaluation/shot-quality.json';
import storyQuality from '../../prompts/quality-evaluation/story-quality.json';
import sceneShotGeneration from '../../prompts/story-generation/scene-shot-generation.json';
import screenplayConversion from '../../prompts/story-generation/screenplay-conversion.json';
import seasonGeneration from '../../prompts/story-generation/season-generation.json';
import seasonOutline from '../../prompts/story-generation/season-outline.json';
// =============================================================================
// Story Generation Prompts
// =============================================================================
import storyGeneration from '../../prompts/story-generation/story-generation.json';
import storyIdeation from '../../prompts/story-generation/story-ideation.json';
import extractAssetDescription from '../../prompts/story-generation/extract-asset-description.json';
import type { PromptTemplate } from '../types';

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

  'scene-shot-generation': sceneShotGeneration as unknown as PromptTemplate,
  'story-ideation': storyIdeation as unknown as PromptTemplate,
  'story-generation/extract-asset-description':
    extractAssetDescription as unknown as PromptTemplate,

  // Analytics
  'insights-generation': insightsGeneration as unknown as PromptTemplate,
  'language-insights': languageInsights as unknown as PromptTemplate,

  // Audio Generation
  'dialogue-translation': dialogueTranslation as unknown as PromptTemplate,
  'scene-audio-refinement': sceneAudioRefinement as unknown as PromptTemplate,

  // Publishing
  'batch-translate-metadata':
    batchTranslateMetadata as unknown as PromptTemplate,
  'linkedin-post-generation':
    linkedinPostGeneration as unknown as PromptTemplate,

  // Quality Evaluation (used by agent skills: Viral Analyst, Reel Scout)
  'quality-evaluation/reel-scout': reelScout as unknown as PromptTemplate,
  'quality-evaluation/screenplay-quality':
    screenplayQuality as unknown as PromptTemplate,
  'quality-evaluation/shot-quality': shotQuality as unknown as PromptTemplate,
  'quality-evaluation/story-quality': storyQuality as unknown as PromptTemplate,

  // Canon Roles
  'canon-extraction': canonExtraction as unknown as PromptTemplate,

  // Documentary
  'documentary/fact-checker-role': factCheckerRole as unknown as PromptTemplate,
  'documentary/fact-extraction': factExtraction as unknown as PromptTemplate,
  'documentary/researcher-role': researcherRole as unknown as PromptTemplate,

  // Movie
  'movie/act-context-extraction':
    actContextExtraction as unknown as PromptTemplate,

  // News Generation
  'news-generation/anchor-role': anchorRole as unknown as PromptTemplate,
  'news-generation/entity-extraction':
    entityExtraction as unknown as PromptTemplate,
  'news-generation/producer-role': producerRole as unknown as PromptTemplate,
  'news-generation/topic-summary': topicSummary as unknown as PromptTemplate,
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
export function getPromptFromRegistry(
  slug: string,
): PromptTemplate | undefined {
  return PROMPT_REGISTRY[slug];
}
