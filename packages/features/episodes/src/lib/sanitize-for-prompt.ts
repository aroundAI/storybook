/**
 * Sanitize user-controlled strings before injecting into LLM prompts.
 *
 * Mitigates common prompt injection vectors:
 * - Markdown/template delimiters (---, ```, {{ }})
 * - XML-style role markers (<system>, <user>, <assistant>, etc.)
 * - Instruction override patterns (IGNORE PREVIOUS, SYSTEM OVERRIDE)
 *
 * Uses iterative tag stripping to prevent nested tag bypass
 * (e.g., `<<system>system>` → `<system>` after single pass).
 */
export function sanitizeForPrompt(input: string): string {
  let result = input
    .replace(/---/g, '—')
    .replace(/```/g, "'''")
    .replace(/\{\{/g, '{ {')
    .replace(/\}\}/g, '} }')
    .replace(
      /\bIGNORE\s+(?:ALL\s+)?(?:PREVIOUS|ABOVE)\b|\bSYSTEM\s+OVERRIDE\b/gi,
      '[FILTERED]',
    );

  // Iteratively strip role tags to prevent nested bypass
  const roleTagPattern =
    /<\/?(?:system|user|assistant|prompt|instruction)[^>]*>/gi;
  let previous = '';

  while (previous !== result) {
    previous = result;
    result = result.replace(roleTagPattern, '');
  }

  return result;
}

/**
 * Applies `sanitizeForPrompt` to every string in a plain value — nested
 * objects and arrays included — and leaves everything else as it is. For a
 * tool result about to reach a model: sanitising the whole result, rather
 * than chosen fields, cannot miss a field added later (KB-72).
 */
export function sanitizeStrings<T>(value: T): T {
  if (typeof value === 'string') return sanitizeForPrompt(value) as T;

  if (Array.isArray(value)) return value.map(sanitizeStrings) as T;

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizeStrings(entry),
      ]),
    ) as T;
  }

  return value;
}
