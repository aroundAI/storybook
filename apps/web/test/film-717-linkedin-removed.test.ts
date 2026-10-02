import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-717. LinkedIn is removed from the product (owner, 2026-10-02: its
 * text-post path "doesn't fit within how all the other platforms are
 * integrated"; it will be planned again later, FILM-718). This fails if the
 * name comes back anywhere in application, infrastructure or documentation
 * files, as FILM-514's scan does for its two music vendors.
 *
 * What is left on purpose, file by file, with the reason:
 * - the database keeps 'linkedin' in its platform CHECKs, and old rows keep
 *   the value (no destructive migration was asked for), so migration history
 *   and the schema mirrors of those constraints say it;
 * - Supabase's own list of sign-in providers in `config.toml`;
 * - the tests that prove a kept LinkedIn row is hidden, never refreshed and
 *   never published to, and the guards that prove those tests can fail.
 */
const REPO = join(__dirname, '..', '..', '..');

export const REMOVED = /linkedin/i;

const ROOTS = [
  'apps',
  'packages',
  'tooling',
  'scripts',
  '.github',
  'deployment',
  'docs',
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

const KEPT = new Set([
  // The platform CHECKs, mirrored from the migrations that still hold them.
  'apps/web/supabase/schemas/30-film-studio.sql',
  'apps/web/supabase/schemas/31-oauth-states.sql',
  'apps/web/supabase/schemas/32-platform-connections.sql',
  'apps/web/supabase/schemas/38-revenue-tracking.sql',
  'apps/web/supabase/schemas/40-social-posts.sql',
  // The publishes CHECK and publish_format_family keep it for old rows.
  'packages/clickhouse/__tests__/format-families.test.ts',
  'packages/clickhouse/__tests__/channel-experiment-sql.test.ts',
  // Supabase CLI's comment listing every provider it supports.
  'apps/web/supabase/config.toml',
  // A kept row: hidden, refused, never refreshed, never created.
  'packages/features/publishing/__tests__/platforms.test.ts',
  'packages/features/publishing/__tests__/removed-platform.test.ts',
  'packages/features/publishing/__tests__/token-refresh.test.ts',
  'packages/features/publishing/__tests__/connection-actions.test.ts',
  'packages/features/publishing/__tests__/publish-actions.test.ts',
  'packages/features/content-analytics/__tests__/channels-language.test.ts',
  'apps/web/lambda/publish-worker/__tests__/removed-platform.test.ts',
  'apps/e2e/tests/platform-connections/linkedin-removed.spec.ts',
  'apps/e2e/tests/analytics/provenance-surfaces.spec.ts',
  // This file and the guards that prove the rules can fail.
  'apps/web/test/film-717-linkedin-removed.test.ts',
  'tooling/mutation-guards/film-717.json',
]);

const SOURCE =
  /\.(ts|tsx|js|mjs|cjs|json|sql|ya?ml|sh|py|mdoc|md|html|toml|css)$/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(path);
    }

    return SOURCE.test(entry.name) ? [path] : [];
  });
}

export function findRemovedName(
  files: Array<{ path: string; source: string }>,
) {
  return files.flatMap(({ path, source }) =>
    REMOVED.test(source)
      ? source
          .split('\n')
          .flatMap((line, index) =>
            REMOVED.test(line) ? [`${path}:${index + 1}`] : [],
          )
      : [],
  );
}

describe('FILM-717: LinkedIn stays removed', () => {
  it('finds the name in any case, and not the other platforms (controls)', () => {
    expect(
      findRemovedName([
        { path: 'a.ts', source: "import { LinkedInProvider } from './li';" },
        { path: 'b.ts', source: 'const id = process.env.LINKEDIN_CLIENT_ID;' },
        { path: 'c.ts', source: "if (platform === 'linkedin') return;" },
        { path: 'd.md', source: '| LinkedIn | posts |' },
        { path: 'e.ts', source: "const platforms = ['youtube', 'twitter'];" },
        { path: 'f.ts', source: "import { Link } from 'next/link';" },
      ]),
    ).toEqual(['a.ts:1', 'b.ts:1', 'c.ts:1', 'd.md:1']);
  });

  it('no application, infrastructure or documentation file names it', () => {
    const files = [
      ...ROOTS.flatMap((root) => sourceFiles(join(REPO, root))),
      ...FILES.map((file) => join(REPO, file)),
    ]
      .map((path) => relative(REPO, path))
      .filter((path) => !KEPT.has(path))
      .map((path) => ({
        path,
        source: readFileSync(join(REPO, path), 'utf8'),
      }));

    expect(files.length).toBeGreaterThan(500);
    expect(findRemovedName(files)).toEqual([]);
  }, 30_000);

  it('keeps nothing it does not need to', () => {
    for (const path of KEPT) {
      expect(
        REMOVED.test(readFileSync(join(REPO, path), 'utf8')),
        `${path} no longer names it: drop it from KEPT`,
      ).toBe(true);
    }
  });
});
