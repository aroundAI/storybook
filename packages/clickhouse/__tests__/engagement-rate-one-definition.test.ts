import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1713: engagement rate has exactly one definition in the repository,
 * `engagementRatio` in `lib/measures.ts`. This fails any other source file
 * that divides a likes + comments + shares sum (code or a comment restating
 * it) — the eight copies this replaced, or a ninth. A class guard, not a per-site one.
 */

const REPO = path.resolve(__dirname, '../../..');
const ROOTS = ['packages', 'apps'];
const SKIP = new Set(['node_modules', '__tests__', '.next', 'dist', '.turbo']);
const HOME = path.join('packages', 'clickhouse', 'src', 'lib', 'measures.ts');

/** A likes + comments + shares sum, closed and divided. */
const INLINE_ENGAGEMENT =
  /likes\s*\+\s*[\w.]*comments\s*\+\s*[\w.]*shares\s*\)\s*\//i;

/**
 * Files allowed to state the formula, each with why. Case-insensitive
 * matching (`epLikes + epComments + epShares`) was how a ninth copy was found,
 * and it also finds user-facing copy that describes the definition.
 */
const STATES_THE_DEFINITION: Record<string, string> = {
  [path.join(
    'packages',
    'features',
    'content-analytics',
    'src',
    'components',
    'episode-analytics.tsx',
  )]:
    'On-screen explanation of the displayed figure; FILM-1719 owns that copy.',
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
      ? [full]
      : [];
  });
}

describe('engagement rate has one definition (FILM-1713)', () => {
  it('lives in lib/measures.ts', () => {
    expect(readFileSync(path.join(REPO, HOME), 'utf8')).toMatch(
      /export function engagementRatio/,
    );
  });

  it('is computed inline nowhere else', () => {
    const inline = ROOTS.flatMap((root) => sources(path.join(REPO, root)))
      .filter((file) => path.relative(REPO, file) !== HOME)
      .filter((file) => !(path.relative(REPO, file) in STATES_THE_DEFINITION))
      .filter((file) => INLINE_ENGAGEMENT.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(REPO, file));

    expect(inline).toEqual([]);
  });
});
