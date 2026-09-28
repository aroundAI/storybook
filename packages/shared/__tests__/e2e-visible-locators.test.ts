import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-136's class. Every `/home` page streams in under a `loading.tsx`, and
 * for a moment React can hold a hidden copy of the content beside the one on
 * screen. A bare `locator('[data-test=…]')` then matches twice and strict
 * mode fails the test at once: KB-136 (the audio library) and the
 * `episode-video-scope` retry were both this. `byTest(page, id)` from
 * `apps/e2e/tests/utils/visible.ts` matches only what a user sees.
 *
 * A ratchet, not a ban: the bare uses already written are counted, and the
 * count may only go down. A file input is exempt — it is hidden on purpose,
 * and `setInputFiles` needs the element itself.
 */

const REPO = resolve(__dirname, '../../..');
const E2E = join('apps', 'e2e', 'tests');
const HELPER = join(E2E, 'utils', 'visible.ts');

/** Bare uses on `main` when this was written; lower it as they are migrated. */
const CEILING = 688;

const BARE = /locator\(\s*['"`]\[data-test=/;

function files(path: string): string[] {
  const absolute = join(REPO, path);
  if (statSync(absolute).isDirectory()) {
    return readdirSync(absolute).flatMap((entry) => files(join(path, entry)));
  }
  return /\.ts$/.test(path) ? [path] : [];
}

export function bareUses(source: string): number {
  return source
    .split('\n')
    .filter((line) => BARE.test(line) && !line.includes('setInputFiles'))
    .length;
}

describe('e2e specs match what a user sees (KB-136)', () => {
  const specs = files(E2E).filter((file) => file !== HELPER);

  it('finds the specs it is checking', () => {
    expect(specs.length).toBeGreaterThan(50);
  });

  it('adds no bare [data-test] locator; use byTest(page, id)', () => {
    const count = specs.reduce(
      (total, file) => total + bareUses(readFileSync(join(REPO, file), 'utf8')),
      0,
    );

    expect(
      count,
      'a new bare locator: use byTest(page, id) from tests/utils/visible.ts',
    ).toBeLessThanOrEqual(CEILING);
    expect(
      count,
      `bare locators went down to ${count}: lower CEILING to match`,
    ).toBe(CEILING);
  });

  it('counts the shapes it guards against', () => {
    expect(bareUses(`page.locator('[data-test="upload-full-video"]')`)).toBe(1);
    expect(bareUses('page.locator(`[data-test="row-${id}"]`)')).toBe(1);
    expect(bareUses(`byTest(page, 'upload-full-video')`)).toBe(0);
    expect(
      bareUses(
        `page.locator('[data-test="upload-video-file"]').setInputFiles(file)`,
      ),
    ).toBe(0);
  });
});
