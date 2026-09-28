import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-139. `episodes.season_id` is nullable (`on delete set null`), so an
 * episode need not be in a season. A read that finds a project through
 * `seasons!inner` drops every such episode without an error: KB-48 R9 found
 * it in an RLS policy, and KB-139 in five reads (a music cue that could not
 * be regenerated, publishes missing from dashboards and reports).
 * `episodes.project_id` is the link; this fails the next read that goes
 * through seasons instead.
 */

const REPO = resolve(__dirname, '../../..');
const ROOTS = ['packages', join('apps', 'web')];
const SKIP = new Set([
  'node_modules',
  '.next',
  '.turbo',
  '.open-next',
  'dist',
  'coverage',
  '__tests__',
  'supabase',
]);
const SOURCE = /\.(ts|tsx)$/;
const TEST_FILE = /\.(test|spec)\.tsx?$/;

const THROUGH_SEASONS = /seasons!inner|episodes\.seasons\./;

function sourceFiles(path: string): string[] {
  const absolute = join(REPO, path);
  if (statSync(absolute).isDirectory()) {
    return readdirSync(absolute).flatMap((entry) =>
      SKIP.has(entry) ? [] : sourceFiles(join(path, entry)),
    );
  }
  return SOURCE.test(path) && !TEST_FILE.test(path) ? [path] : [];
}

export function findsProjectThroughSeasons(source: string): boolean {
  return THROUGH_SEASONS.test(source);
}

describe('KB-139: a project is found through episodes.project_id', () => {
  const files = ROOTS.flatMap(sourceFiles);

  it('finds the source it is checking', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it('no read reaches the project through seasons', () => {
    const offenders = files.filter((file) =>
      findsProjectThroughSeasons(readFileSync(join(REPO, file), 'utf8')),
    );

    expect(
      offenders,
      "episodes.season_id is nullable: select episodes!inner(project_id) and filter on 'episodes.project_id'",
    ).toEqual([]);
  });

  it('flags the shapes it guards against', () => {
    expect(
      findsProjectThroughSeasons(
        'episodes!inner(season_id, seasons!inner(project_id))',
      ),
    ).toBe(true);
    expect(
      findsProjectThroughSeasons(".eq('episodes.seasons.project_id', id)"),
    ).toBe(true);
    expect(findsProjectThroughSeasons('episodes!inner(project_id)')).toBe(
      false,
    );
    expect(findsProjectThroughSeasons(".from('seasons').select('id')")).toBe(
      false,
    );
  });
});
