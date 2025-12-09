/**
 * Element Prompt Generation Module (FILM-209)
 *
 * Provides utilities for generating element prompts for Kling AI video generation.
 *
 * Usage:
 * ```typescript
 * import { generateElementPrompt } from '@kit/assets/element-prompt';
 *
 * const result = await generateElementPrompt({
 *   character,
 *   style: 'realistic',
 * });
 *
 * console.log(result.prompt);
 * console.log(result.source); // 'llm' | 'template' | 'cache'
 * ```
 */

// Main generation functions
export {
  generateElementPrompt,
  batchGenerateElementPrompts,
  type GenerateElementPromptInput,
  type GenerateElementPromptOutput,
  type BatchGenerateOptions,
  type BatchGenerateResult,
} from './generate-element-prompt';

// Validation
export {
  validateElementPrompt,
  type ValidationResult,
} from './prompt-validator';

// Template fallback
export { generateWithTemplate } from './template-generator';

// Guidelines constants
export {
  KLING_GUIDELINES,
  SUBJECTIVE_WORDS,
  PERSONALITY_WORDS,
} from './kling-guidelines';

// Cache management
export { invalidatePromptCache } from './cache';

// LLM generator type
export type { PromptStyle } from './llm-generator';
