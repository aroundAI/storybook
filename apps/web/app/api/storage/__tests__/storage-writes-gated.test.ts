import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-57: R2 has no storage policies. Production writes it with the app's own
 * credentials, so the only project check on a write is the one the server
 * runs. Each writer used to carry its own: a check on a project id, next to
 * a key built by hand that nothing tied to it, and four key shapes that
 * named no project at all.
 *
 * Every server-side write now goes through `writeProjectObject` in
 * `@kit/storage`, which asks `can_write_project_storage` about the key
 * itself. This fails when a storage write appears anywhere else.
 */

const ROOT = path.resolve(__dirname, '../../../../../..');
const SOURCE_ROOTS = ['apps/web', 'packages'].map((dir) =>
  path.join(ROOT, dir),
);
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  '__tests__',
  '__mocks__',
]);

/** A call that puts bytes in storage, or signs a URL that will */
const WRITE_CALL = /\.(?:upload|getSignedUploadUrl)\(/;

/**
 * The only places a write may appear, and why. `mustCall` is the check the
 * file has to make before it writes.
 */
const ALLOWED: Record<string, { why: string; mustCall?: string }> = {
  'packages/features/storage/src/project-write.ts': { why: 'the gate' },
  'packages/features/storage/src/adapters/supabase.ts': {
    why: 'the adapter the gate calls',
  },
  'apps/web/app/api/storage/presign/route.ts': {
    why: 'signs a user-chosen key once the gate has checked it',
    mustCall: 'canWrite: canWriteProjectKey,',
  },
  'packages/features/content-analytics/src/server/report-storage.ts': {
    why: 'reports never go to R2: the private Supabase bucket, behind RLS (KB-55 D2)',
  },
  'packages/ui/src/hooks/use-supabase-upload.tsx': {
    why: "the browser's own Supabase session, which the bucket policies check",
  },
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.(ts|tsx|mts|js|mjs)$/.test(name)) return [];
    if (/\.(test|spec)\.[a-z]+$/.test(name)) return [];
    return [full];
  });
}

/** Source with comment lines blanked, so examples in docs don't count */
function code(file: string) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => (/^\s*(\*|\/\/|\/\*)/.test(line) ? '' : line))
    .join('\n');
}

const files = SOURCE_ROOTS.flatMap(sourceFiles).map((file) => ({
  file: path.relative(ROOT, file),
  source: code(file),
}));

describe('every storage write goes through the project check (KB-57)', () => {
  it('no write call outside the gate and the files allowed one', () => {
    const outside = files
      .filter(({ file, source }) => !ALLOWED[file] && WRITE_CALL.test(source))
      .map(({ file }) => file);

    expect(outside).toEqual([]);
  });

  it.each(Object.entries(ALLOWED).filter(([, rule]) => rule.mustCall))(
    '%s makes its check',
    (file, rule) => {
      const found = files.find((entry) => entry.file === file);

      expect(
        found,
        `${file} is allowed a write but does not exist`,
      ).toBeDefined();
      expect(found!.source).toContain(rule.mustCall);
    },
  );

  it('the allow-list names only files that exist', () => {
    const known = new Set(files.map(({ file }) => file));

    expect(Object.keys(ALLOWED).filter((file) => !known.has(file))).toEqual([]);
  });
});
