/**
 * Element Prompt Generation (FILM-209)
 * Main orchestration for generating element prompts
 */
import 'server-only';

import { getLogger } from '@kit/shared/logger';

import type { Character } from '../types/character.types';
import { cachePrompt, getCachedPrompt } from './cache';
import type { PromptStyle } from './llm-generator';
import { generateWithLLM } from './llm-generator';
import {
  type ValidationResult,
  validateElementPrompt,
} from './prompt-validator';
import { generateWithTemplate } from './template-generator';

/**
 * Input options for element prompt generation
 */
export interface GenerateElementPromptInput {
  character: Character;
  style?: PromptStyle;
  includeBackstory?: boolean;
  skipCache?: boolean;
}

/**
 * Output from element prompt generation
 */
export interface GenerateElementPromptOutput {
  prompt: string;
  wordCount: number;
  warnings: string[];
  source: 'llm' | 'template' | 'cache';
  validation: ValidationResult;
}

/**
 * Options for batch generation
 */
export interface BatchGenerateOptions {
  style?: PromptStyle;
  includeBackstory?: boolean;
  skipCache?: boolean;
  concurrency?: number;
}

/**
 * Result of batch generation for a single character
 */
export interface BatchGenerateResult {
  characterId: string;
  success: boolean;
  output?: GenerateElementPromptOutput;
  error?: string;
}

/**
 * Generate an element prompt for a character
 *
 * Flow:
 * 1. Check cache first (unless skipCache)
 * 2. Try LLM generation
 * 3. Validate LLM result
 * 4. Fall back to template if LLM fails or validation fails
 * 5. Cache successful results
 */
export async function generateElementPrompt(
  input: GenerateElementPromptInput,
): Promise<GenerateElementPromptOutput> {
  const logger = await getLogger();
  const {
    character,
    style = 'realistic',
    includeBackstory = false,
    skipCache = false,
  } = input;

  const ctx = {
    name: 'generate-element-prompt',
    characterId: character.id,
    characterName: character.name,
    style,
  };

  logger.info(ctx, 'Starting element prompt generation');

  // Step 1: Check cache
  if (!skipCache) {
    const cached = await getCachedPrompt(character.id);
    if (cached) {
      const validation = validateElementPrompt(cached);
      logger.info({ ...ctx, source: 'cache' }, 'Using cached prompt');
      return {
        prompt: cached,
        wordCount: validation.wordCount,
        warnings: validation.warnings,
        source: 'cache',
        validation,
      };
    }
  }

  // Step 2: Try LLM generation
  const llmPrompt = await generateWithLLM(character, style, includeBackstory);

  if (llmPrompt) {
    const validation = validateElementPrompt(llmPrompt);

    // If LLM result passes validation, use it
    if (validation.isValid) {
      // Cache the result
      await cachePrompt(character.id, llmPrompt);

      logger.info(
        { ...ctx, source: 'llm', wordCount: validation.wordCount },
        'Using LLM prompt',
      );
      return {
        prompt: llmPrompt,
        wordCount: validation.wordCount,
        warnings: validation.warnings,
        source: 'llm',
        validation,
      };
    }

    // Log validation failures
    logger.warn(
      { ...ctx, errors: validation.errors, warnings: validation.warnings },
      'LLM prompt failed validation',
    );
  }

  // Step 3: Fall back to template
  logger.info({ ...ctx, source: 'template' }, 'Falling back to template');
  const templatePrompt = generateWithTemplate(character, style);
  const validation = validateElementPrompt(templatePrompt);

  // Cache template result only if valid
  if (validation.isValid) {
    await cachePrompt(character.id, templatePrompt);
  }

  return {
    prompt: templatePrompt,
    wordCount: validation.wordCount,
    warnings: validation.warnings,
    source: 'template',
    validation,
  };
}

/**
 * Generate element prompts for multiple characters in parallel
 *
 * Uses Promise.allSettled for resilient batch processing
 */
export async function batchGenerateElementPrompts(
  characters: Character[],
  options: BatchGenerateOptions = {},
): Promise<BatchGenerateResult[]> {
  const logger = await getLogger();
  const { style, includeBackstory, skipCache, concurrency = 5 } = options;

  const ctx = {
    name: 'batch-generate-element-prompts',
    count: characters.length,
    concurrency,
  };

  logger.info(ctx, 'Starting batch generation');

  // Process in batches for controlled concurrency
  const results: BatchGenerateResult[] = [];

  for (let i = 0; i < characters.length; i += concurrency) {
    const batch = characters.slice(i, i + concurrency);

    const batchPromises = batch.map(
      async (character): Promise<BatchGenerateResult> => {
        try {
          const output = await generateElementPrompt({
            character,
            style,
            includeBackstory,
            skipCache,
          });

          return {
            characterId: character.id,
            success: true,
            output,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          logger.error(
            { ...ctx, characterId: character.id, error: errorMessage },
            'Batch generation failed for character',
          );

          return {
            characterId: character.id,
            success: false,
            error: errorMessage,
          };
        }
      },
    );

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  logger.info({ ...ctx, successful, failed }, 'Batch generation complete');

  return results;
}
