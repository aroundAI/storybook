/**
 * "Looks real, is fictional" (phase 18 README). Anything a person could see
 * on screen must read like a real creator's work, never like a fixture. This
 * is the test both sandboxes use (FILM-1802, FILM-1803).
 */

/** Words no invented name, title or line should contain. */
const PLACEHOLDER_WORD =
  /\b(?:test(?:ing)?|seed(?:ed)?|example|sample|dummy|lorem|ipsum|foo|foobar|baz|qux|placeholder|untitled|todo|tbd|xxx|asdf)\b/i;

/** `Character 1`, `Scene A`, `Generated story 4`, `Episode #2`. */
const ENTITIES = [
  'character',
  'scene',
  'shot',
  'episode',
  'location',
  'story',
  'title',
  'idea',
  'video',
  'channel',
  'post',
  'person',
  'user',
  'item',
  'generated',
];
const NUMBERED_ENTITY = new RegExp(
  String.raw`\b(?:${ENTITIES.map((word) => `[${word[0]}${word[0]!.toUpperCase()}]${word.slice(1)}`).join('|')})\s*#?\s*(?:\d+|[A-Z])\b(?![a-z'])`,
);

/** A name ending in a counter: `Mara 2`, `Harbor Lights 07`. */
const TRAILING_COUNTER = /[A-Za-z]\s*[-_#]?\s*\d+\s*$/;

export interface PlaceholderFinding {
  path: string;
  value: string;
  rule: 'placeholder word' | 'numbered entity' | 'trailing counter';
}

export function placeholderIn(value: string, isName: boolean) {
  if (PLACEHOLDER_WORD.test(value)) return 'placeholder word' as const;
  if (NUMBERED_ENTITY.test(value)) return 'numbered entity' as const;
  if (isName && TRAILING_COUNTER.test(value))
    return 'trailing counter' as const;
  return null;
}

/** Fields that are names or titles: a trailing number is never right there. */
const NAME_FIELD = /title|name|character|speaker|location|setting|headline/i;

/** Walks any JSON value and reports every string that looks like a fixture. */
export function findPlaceholders(
  value: unknown,
  path: string[] = [],
): PlaceholderFinding[] {
  if (typeof value === 'string') {
    const field = [...path].reverse().find((part) => !/^\d+$/.test(part)) ?? '';
    const rule = placeholderIn(value, NAME_FIELD.test(field));
    return rule ? [{ path: path.join('.'), value, rule }] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, i) =>
      findPlaceholders(item, [...path, String(i)]),
    );
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      findPlaceholders(item, [...path, key]),
    );
  }

  return [];
}
