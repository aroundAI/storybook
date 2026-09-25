import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-514. The two music vendors behind the provider registry, Suno and
 * Udio, are retired (owner, 2026-09-25): "If we need it then we would do it
 * from scratch later." This fails if either name comes back in application,
 * infrastructure or user-facing documentation: the providers, their
 * actions, the API-key card, the enums, the vendor URLs, the legal pages.
 * Music is generated with ElevenLabs.
 *
 * `(?!s)` keeps esbuild's `sunos` platform packages in the lockfile out;
 * `(?<![a-z])` keeps `audio` and `studio` out.
 * Migration history is excluded because it is history: the
 * `external_api_keys` check constraint still admits `suno`. Generated types
 * come from the database. Specs describe the retirement, so they are not
 * scanned.
 */
const REPO = join(__dirname, '..', '..', '..');

export const RETIRED = /suno(?!s)|(?<![a-z])udio/i;

const ROOTS = [
  'apps',
  'packages',
  'tooling',
  'scripts',
  '.github',
  'deployment',
];
const FILES = [
  'sst.config.ts',
  'package.json',
  'turbo.json',
  'pnpm-lock.yaml',
  'README.md',
];

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
  'apps/web/lib/database.types.ts',
  'packages/supabase/src/database.types.ts',
  // Mirrors the external_api_keys check constraint, which is kept until the
  // owner decides about stored rows (FILM-514).
  'apps/web/supabase/schemas/30-film-studio.sql',
  // This file and the guards that prove it can fail.
  'apps/web/test/film-514-music-vendors-retired.test.ts',
  'tooling/mutation-guards/film-514.json',
]);

const SOURCE = /\.(ts|tsx|js|mjs|cjs|json|sql|ya?ml|sh|py|mdoc|md|html)$/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(path);
    }

    return SOURCE.test(entry.name) ? [path] : [];
  });
}

export function findRetiredName(
  files: Array<{ path: string; source: string }>,
) {
  return files.flatMap(({ path, source }) =>
    RETIRED.test(source)
      ? source
          .split('\n')
          .flatMap((line, index) =>
            RETIRED.test(line) ? [`${path}:${index + 1}`] : [],
          )
      : [],
  );
}

describe('FILM-514: the retired music vendors stay retired', () => {
  it('finds either name, and not "sunos", "audio" or "studio" (controls)', () => {
    expect(
      findRetiredName([
        { path: 'a.ts', source: "import { SunoProvider } from './suno';" },
        { path: 'b.ts', source: 'const k = process.env.SUNO_API_KEY;' },
        { path: 'c.ts', source: "import { UdioProvider } from './udio';" },
        { path: 'd.ts', source: 'const k = process.env.UDIO_API_KEY;' },
        { path: 'e.yaml', source: "'@esbuild/sunos-x64@0.25.11':" },
        { path: 'f.ts', source: "import { AUDIO_TYPES } from '@kit/audio';" },
        { path: 'g.ts', source: 'const route = `${studio}/audio-studio`;' },
      ]),
    ).toEqual(['a.ts:1', 'b.ts:1', 'c.ts:1', 'd.ts:1']);
  });

  it('no application, infrastructure or documentation file names them', () => {
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
    expect(findRetiredName(files)).toEqual([]);
  }, 30_000);
});
