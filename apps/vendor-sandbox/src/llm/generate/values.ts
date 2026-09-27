import type { GenerateContext } from './context';
import { nounOf } from './context';

function fieldName(path: readonly string[]) {
  return [...path].reverse().find((part) => !/^\d+$/.test(part)) ?? '';
}

interface NumberBounds {
  min?: number;
  max?: number;
  integer: boolean;
}

const SCORE = /score|rating|quality|confidence|potential|strength|accuracy/i;
const UNIT =
  /confidence|probability|ratio|rate$|sentiment|accuracy|weight|intensity/i;

function round(value: number, integer: boolean) {
  return integer ? Math.round(value) : Math.round(value * 100) / 100;
}

/**
 * A plausible number for a field: inside the schema's bounds, shaped by the
 * field's name. Scores sit high in their range when quality is `high`, so a
 * quality gate passes first time, and low when it is `low`.
 */
export function numberForField(
  path: readonly string[],
  ctx: GenerateContext,
  bounds: NumberBounds,
) {
  const name = fieldName(path);
  const isScore = SCORE.test(name);

  let min = bounds.min;
  let max = bounds.max;
  let integer = bounds.integer;

  if (min === undefined || max === undefined) {
    const [dMin, dMax, dInt] = UNIT.test(name)
      ? [0, 1, false]
      : /percent/i.test(name)
        ? [0, 100, true]
        : isScore
          ? [1, 10, true]
          : /duration|seconds|runtime|length|time$/i.test(name)
            ? [8, 90, true]
            : /char(acter)?count/i.test(name)
              ? [180, 1300, true]
              : /year/i.test(name)
                ? [2019, 2026, true]
                : /number|index|order|sequence|count|total|position|episode|scene|act|segment/i.test(
                      name,
                    )
                  ? [1, 12, true]
                  : [1, 100, true];
    min ??= Math.max(dMin, max !== undefined ? max - (dMax - dMin) : dMin);
    max ??= Math.max(min, dMax);
    if (bounds.min === undefined && bounds.max === undefined) integer ||= dInt;
  }

  if (isScore) {
    const span = max - min;
    const [lo, hi] = ctx.quality === 'high' ? [0.75, 0.95] : [0.1, 0.3];
    return Math.min(
      max,
      Math.max(min, round(min + span * ctx.rng.float(lo, hi), integer)),
    );
  }

  const value = integer
    ? ctx.rng.int(Math.ceil(min), Math.floor(max))
    : round(ctx.rng.float(min, max), false);
  return Math.min(max, Math.max(min, value));
}

interface LengthBounds {
  min?: number;
  max?: number;
  ofStrings: boolean;
}

/**
 * How many items: the count the prompt asked for when the field names the
 * same noun (`ideas` for "3 story ideas"), otherwise a small realistic number,
 * always inside the schema's bounds.
 */
export function arrayLength(
  path: readonly string[],
  ctx: GenerateContext,
  bounds: LengthBounds,
) {
  const min = bounds.min ?? 0;
  const max = bounds.max ?? 60;
  const asked = ctx.counts.get(nounOf(fieldName(path)));
  const wanted =
    asked ?? (bounds.ofStrings ? ctx.rng.int(2, 3) : ctx.rng.int(2, 4));
  return Math.min(max, Math.max(min, wanted));
}

/**
 * `length` items from `make`, retrying a few times to avoid repeating a
 * string: a post with the same hashtag twice reads like a fixture.
 */
export function distinctItems(
  length: number,
  make: (index: number) => unknown,
) {
  const items: unknown[] = [];
  for (let i = 0; i < length; i++) {
    let item = make(i);
    for (
      let retry = 0;
      retry < 4 && typeof item === 'string' && items.includes(item);
      retry++
    ) {
      item = make(i);
    }
    items.push(item);
  }
  return items;
}

const CAST_LIST = /^(characters?|cast|people|speakers?|characterStates|characterVoices)$/i;

/**
 * A list of characters is one entry per cast member: `characters` with the
 * same name four times reads like a bug, and the app matches by name. Each
 * item is generated with the cast narrowed to its own person, so every name
 * inside it agrees. Undefined when the list is not one of characters.
 */
export function castListContexts(
  path: readonly string[],
  ctx: GenerateContext,
  length: number,
  bounds: { min?: number; ofObjects: boolean },
) {
  const people = ctx.cast.people;
  if (!bounds.ofObjects || people.length === 0 || !CAST_LIST.test(fieldName(path)))
    return undefined;
  const count = Math.max(bounds.min ?? 0, Math.min(length, people.length));
  return Array.from({ length: count }, (_, i) => ({
    ...ctx,
    cast: { ...ctx.cast, people: [people[i % people.length]!] },
  }));
}
