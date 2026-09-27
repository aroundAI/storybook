import { type Cast, drawCast } from '../../corpus';
import type { Rng } from '../../rng';

export type Quality = 'high' | 'low';

/** Everything one response is generated from. */
export interface GenerateContext {
  rng: Rng;
  /** One cast per response, so its names and places agree with each other. */
  cast: Cast;
  /** Counts the rendered user prompt asks for, by noun: `ideas` → 3. */
  counts: Map<string, number>;
  /** String fields no corpus rule placed, reported on the status page. */
  unplaced: Set<string>;
  /**
   * `high` scores pass every quality gate on the first pass, so an
   * orchestrator does not loop; `low` exercises the regeneration path.
   */
  quality: Quality;
}

const COUNTED =
  /\b(\d{1,3})\s+(?:(?:unique|distinct|new|separate|story|short|key|main|total)\s+){0,2}([a-z]+)/gi;

function singular(noun: string) {
  const word = noun.toLowerCase();
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** "Generate 3 unique story ideas" → `idea` → 3. The first mention wins. */
export function countsFromPrompt(userPrompt: string) {
  const counts = new Map<string, number>();
  for (const match of userPrompt.matchAll(COUNTED)) {
    const noun = singular(match[2] ?? '');
    const count = Number(match[1]);
    if (!counts.has(noun) && count > 0 && count <= 60) counts.set(noun, count);
  }
  return counts;
}

export function nounOf(field: string) {
  const words = field
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_]+/)
    .filter(Boolean);
  return singular(words.at(-1) ?? field);
}

const PERSON = /^[A-Z][\p{L}'’-]+(?: [A-Z][\p{L}'’-]+){0,3}$/u;

/**
 * The characters a prompt names, in the forms the app's context builders
 * write them (apps/web/lambda/llm-worker/utils/context-builder.ts):
 * `Name: X` lines, `Character Names: A, B`, `- **X** (role)`, the VEO
 * block's `### X (role)` and
 * `Characters: A, B`. A reply must use these names - the app matches
 * dialogue to its characters by name - so they replace the random cast.
 */
export function castFromPrompt(userPrompt: string) {
  const names: string[] = [];
  const add = (value: string) => {
    const name = value.trim().replace(/[.*]+$/, '');
    if (PERSON.test(name) && !names.includes(name)) names.push(name);
  };
  for (const m of userPrompt.matchAll(/^\s*Name:\s*(.+)$/gm)) add(m[1]!);
  for (const m of userPrompt.matchAll(/^\s*- \*\*([^*]+)\*\* \(/gm)) add(m[1]!);
  for (const m of userPrompt.matchAll(/^###\s+([^(\n]+?)\s+\(/gm)) add(m[1]!);
  for (const m of userPrompt.matchAll(/Character(?:s| Names)(?: for Dialogue)?\**:\s*\**\s*([^\n]+)/g)) {
    for (const part of m[1]!.split(',')) add(part);
  }
  return names.slice(0, 8);
}

export function createContext(
  rng: Rng,
  userPrompt: string,
  quality: Quality = 'high',
): GenerateContext {
  const cast = drawCast(rng);
  const named = castFromPrompt(userPrompt);
  if (named.length > 0) cast.people = named;

  return {
    rng,
    cast,
    counts: countsFromPrompt(userPrompt),
    unplaced: new Set(),
    quality,
  };
}
