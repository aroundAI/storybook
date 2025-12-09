/**
 * Element Prompt Validator (FILM-209)
 * Validates generated prompts against Kling AI guidelines
 */
import { PERSONALITY_WORDS, SUBJECTIVE_WORDS } from './kling-guidelines';

const MIN_WORD_COUNT = 50;
const MAX_WORD_COUNT = 200;

/**
 * Result of validating an element prompt
 */
export interface ValidationResult {
  isValid: boolean;
  wordCount: number;
  warnings: string[];
  errors: string[];
}

/**
 * Validates an element prompt against Kling AI guidelines
 */
export function validateElementPrompt(prompt: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Word count
  const words = prompt.trim().split(/\s+/);
  const wordCount = words.length;

  if (wordCount < MIN_WORD_COUNT) {
    errors.push(
      `Prompt is too short (${wordCount} words, minimum ${MIN_WORD_COUNT})`,
    );
  }

  if (wordCount > MAX_WORD_COUNT) {
    errors.push(
      `Prompt is too long (${wordCount} words, maximum ${MAX_WORD_COUNT})`,
    );
  }

  const lowerPrompt = prompt.toLowerCase();

  // Check subjective language
  SUBJECTIVE_WORDS.forEach((word) => {
    if (lowerPrompt.includes(word)) {
      warnings.push(`Contains subjective word: "${word}"`);
    }
  });

  // Check personality traits
  PERSONALITY_WORDS.forEach((word) => {
    // Use word boundary to avoid false positives (e.g., "kind" in "kindred")
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(lowerPrompt)) {
      warnings.push(`Contains personality trait: "${word}" (not visual)`);
    }
  });

  // Check for past tense
  if (lowerPrompt.match(/\b(was|were|had)\b/)) {
    warnings.push('Contains past tense (use present tense)');
  }

  // Check for first/second person
  if (lowerPrompt.match(/\b(i|me|my|you|your)\b/)) {
    warnings.push('Contains first/second person (use third person)');
  }

  return {
    isValid: errors.length === 0,
    wordCount,
    warnings,
    errors,
  };
}
