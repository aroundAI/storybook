/**
 * JSON out of a model reply: markdown fences, DeepSeek <think> blocks and
 * trailing text are tolerated; an unbalanced or mistyped body is an error.
 * One copy, where the two executors each had their own.
 */
export type JsonShape = 'array' | 'object';

function findBalancedJSON(content: string, type: JsonShape): string | null {
  const openChar = type === 'array' ? '[' : '{';
  const closeChar = type === 'array' ? ']' : '}';

  const startIndex = content.indexOf(openChar);
  if (startIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === openChar) depth++;
      else if (char === closeChar) {
        depth--;
        if (depth === 0) {
          return content.substring(startIndex, i + 1);
        }
      }
    }
  }

  return null;
}

export function extractJSON<T = unknown>(
  content: string,
  type: JsonShape | 'json',
): T {
  const normalizedType: JsonShape = type === 'json' ? 'object' : type;

  let cleaned = content.trim();
  const jsonMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    cleaned = jsonMatch[1]!.trim();
  }

  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  let jsonString = findBalancedJSON(cleaned, normalizedType);

  if (!jsonString) {
    const pattern = normalizedType === 'array' ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
    const match = cleaned.match(pattern);
    if (match) jsonString = match[0].trim();
  }

  if (!jsonString) {
    throw new Error(
      `No ${normalizedType} found in LLM response. Response was: ${content.substring(0, 200)}...`,
    );
  }

  const trimmedMatch = jsonString.trim();

  try {
    const parsed = JSON.parse(trimmedMatch);
    const actualType = Array.isArray(parsed) ? 'array' : 'object';

    if (actualType !== normalizedType) {
      throw new Error(
        `Expected ${normalizedType} but got ${actualType} in LLM response`,
      );
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Invalid JSON syntax in LLM response: ${error.message}. Matched content: ${trimmedMatch.substring(0, 200)}...`,
      );
    }
    throw error;
  }
}
