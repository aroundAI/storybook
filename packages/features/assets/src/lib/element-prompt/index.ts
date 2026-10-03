/**
 * Element Prompt Generation Module (FILM-209)
 *
 * Provides utilities for generating element prompts for Kling AI video generation.
 *
 * The LLM generator and its `generateElementPrompt` wrapper had no caller and
 * were deleted in FILM-1902; the template generator, validator and cache stay.
 */

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
