import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { wholeShotSeconds } from '../src/lib/schemas/shot-list.schema';

/**
 * KB-130: `shots.duration_seconds` is an integer, and the scene-shot prompt's
 * schema lets a model answer 8.35. Postgres refuses the whole insert
 * ("invalid input syntax for type integer"), so the shot list fails. Every
 * writer of the column stores whole seconds.
 */

const ROOT = resolve(__dirname, '../../../..');
const WRITERS = [
  'packages/features/generation/src/stages/shots.ts',
  'packages/features/episodes/src/lib/server/mutations/shot-actions.ts',
];

describe('a shot duration, as the shots table stores it', () => {
  it('is whole seconds, at least one', () => {
    expect(wholeShotSeconds(8.35)).toBe(8);
    expect(wholeShotSeconds(7.5)).toBe(8);
    expect(wholeShotSeconds(0.3)).toBe(1);
    expect(wholeShotSeconds(6)).toBe(6);
  });

  it.each(WRITERS)('is what %s writes, at every write', (file) => {
    const source = readFileSync(resolve(ROOT, file), 'utf8');
    const writes = [...source.matchAll(/duration_seconds\s*[:=]\s*([^,;\n]+)/g)]
      .map((m) => m[1]!.trim())
      .filter((value) => !/^(number|Json|null)\b/.test(value));
    expect(writes.length).toBeGreaterThan(0);
    for (const value of writes) expect(value).toMatch(/^wholeShotSeconds\(/);
  });
});
