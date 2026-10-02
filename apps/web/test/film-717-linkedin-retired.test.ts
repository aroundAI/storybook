import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-717. LinkedIn is retired "for now" (owner, 2026-10-02), instead of
 * moving its pinned API version past sunset (KB-164). The integration was
 * deleted as FILM-514 and FILM-513 deleted theirs; the repository history and
 * the retired FILM-715 hold the design for a return. This fails if any piece
 * of the integration comes back: the provider, its OAuth config and app
 * credentials, the pinned version header, the API and OAuth hosts, the
 * social-post prompt, the composer, the worker's upload and the refresh.
 *
 * The word "LinkedIn" itself is not banned: stored rows keep the platform
 * value, so it is still named where a retired connection or a past publish
 * is shown, and a viewer can still share a public page to LinkedIn with a
 * plain link. Migration history and generated types are history.
 */
const REPO = join(__dirname, '..', '..', '..');

export const RETIRED =
  /LinkedInProvider|LINKEDIN_(?:OAUTH_CONFIG|REST_VERSION|CLIENT_(?:ID|SECRET)|CONSTRAINTS)|VENDOR_URL_LINKEDIN|api\.linkedin\.com|linkedin\.com\/oauth|LinkedIn-Version|linkedin-(?:api|oauth|post-generation)|LinkedInComposer|uploadToLinkedIn|refreshLinkedInToken/;

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
  // This file and the guards that prove it can fail.
  'apps/web/test/film-717-linkedin-retired.test.ts',
  'tooling/mutation-guards/film-717.json',
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

describe('FILM-717: the LinkedIn integration stays retired', () => {
  it('finds each piece of the integration, and not the platform name (controls)', () => {
    expect(
      findRetiredName([
        { path: 'a.ts', source: "import { LinkedInProvider } from './li';" },
        { path: 'b.ts', source: 'const id = process.env.LINKEDIN_CLIENT_ID;' },
        { path: 'c.ts', source: "headers['LinkedIn-Version'] = v;" },
        { path: 'd.ts', source: "fetch('https://api.linkedin.com/v2/posts');" },
        { path: 'e.ts', source: "templateSlug: 'linkedin-post-generation'," },
        { path: 'f.ts', source: "vendorUrl('linkedin-api')" },
        { path: 'g.ts', source: "linkedin: 'LinkedIn'," },
        { path: 'h.ts', source: "if (platform === 'linkedin') return null;" },
        {
          path: 'i.tsx',
          source:
            'href={`https://www.linkedin.com/sharing/share-offsite/?url=${u}`}',
        },
      ]),
    ).toEqual(['a.ts:1', 'b.ts:1', 'c.ts:1', 'd.ts:1', 'e.ts:1', 'f.ts:1']);
  });

  it('no application, infrastructure or documentation file carries it', () => {
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
