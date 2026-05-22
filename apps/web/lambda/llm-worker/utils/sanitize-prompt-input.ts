/**
 * Sanitizes user-provided text before injection into LLM prompt templates.
 *
 * Prevents prompt injection by:
 * 1. Stripping common injection patterns (system/assistant role overrides)
 * 2. Escaping delimiter characters that could break prompt structure
 * 3. Truncating to a maximum length to prevent context stuffing
 *
 * @param input - Raw user-provided text
 * @param maxLength - Maximum allowed character length (default: 50000)
 * @returns Sanitized text safe for prompt injection
 */
export function sanitizePromptInput(input: string, maxLength = 50_000): string {
  if (!input) return '';

  let sanitized = input;

  // Strip common prompt injection patterns (case-insensitive)
  // These patterns attempt to override LLM system instructions
  const injectionPatterns = [
    /\b(system|assistant)\s*:\s*/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi,
    /<<SYS>>/gi,
    /<<\/SYS>>/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
    /\bignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)\b/gi,
    /\byou\s+are\s+now\b/gi,
    /\bforget\s+(all\s+)?(previous|your)\s+(instructions?|rules?|context)\b/gi,
  ];

  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, '');
  }

  // Truncate to max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized.trim();
}
