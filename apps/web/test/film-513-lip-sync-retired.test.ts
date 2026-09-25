import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-513. Lip-sync (SyncLabs, Wav2Lip) is retired (owner, 2026-09-22) and
 * its code, vendor entry and table are removed. This fails if any of its
 * names comes back in application or infrastructure code — including the
 * four environment variables (`SYNCLABS_API_KEY`, `SYNCLABS_BASE_URL`,
 * `WAV2LIP_API_KEY`, `WAV2LIP_API_URL`), two of which redirected vendor
 * traffic with no guard (KB-21).
 *
 * Matching is case-insensitive, so `synclabs` also catches `SYNCLABS_*` and
 * `SyncLabs`, and `lip_sync` catches `lip_sync_jobs` and `LIP_SYNC_*`. The
 * bare word "lip-sync" is not a name: the translation skills use it as prose
 * for dialogue timing, with no coupling to the providers.
 *
 * Migration history is excluded because it is history. The generated types
 * are scanned on purpose: `lip_sync_jobs` must stay out of them.
 */
const REPO = join(__dirname, '..', '..', '..');

export const RETIRED_NAMES = [
  'synclabs',
  'wav2lip',
  'lip_sync',
  'lipsync',
  'providers/lip-sync',
  'lip-sync-actions',
  'lip-sync.schema',
];

const ROOTS = ['apps', 'packages', 'tooling', 'scripts', '.github', 'deployment'];
const FILES = ['sst.config.ts', 'package.json', 'turbo.json', 'pnpm-lock.yaml'];

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  'migrations',
]);

const SKIPPED_FILES = new Set([
  // This file, and the pgTAP test and guards that prove the table gone.
  'apps/web/test/film-513-lip-sync-retired.test.ts',
  'apps/web/supabase/tests/database/lip-sync-retired.test.sql',
  'tooling/mutation-guards/film-513.json',
]);

const SOURCE = /\.(ts|tsx|js|mjs|cjs|json|sql|ya?ml|sh|py|env)$/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(path);
    }

    return SOURCE.test(entry.name) ? [path] : [];
  });
}

export function findRetiredNames(
  files: Array<{ path: string; source: string }>,
) {
  return files.flatMap(({ path, source }) =>
    source.split('\n').flatMap((line, index) => {
      const lower = line.toLowerCase();

      return RETIRED_NAMES.filter((name) => lower.includes(name)).map(
        (name) => `${path}:${index + 1} ${name}`,
      );
    }),
  );
}

describe('FILM-513: lip-sync stays retired', () => {
  it('finds a retired name when one is present (positive control)', () => {
    expect(
      findRetiredNames([
        {
          path: 'fixture.ts',
          source: 'const url = process.env.SYNCLABS_BASE_URL;',
        },
      ]),
    ).toEqual(['fixture.ts:1 synclabs']);
  });

  it('leaves lip-sync prose alone (negative control)', () => {
    expect(
      findRetiredNames([
        {
          path: 'fixture.ts',
          source: '// constrain translation length for lip-sync timing',
        },
      ]),
    ).toEqual([]);
  });

  it('no application or infrastructure file names lip-sync', () => {
    const files = [
      ...ROOTS.flatMap((root) => sourceFiles(join(REPO, root))),
      ...FILES.map((file) => join(REPO, file)),
    ]
      .map((path) => relative(REPO, path))
      .filter((path) => !SKIPPED_FILES.has(path))
      .map((path) => ({
        path,
        source: readFileSync(join(REPO, path), 'utf8'),
      }));

    expect(files.length).toBeGreaterThan(500);
    expect(findRetiredNames(files)).toEqual([]);
  });
});
