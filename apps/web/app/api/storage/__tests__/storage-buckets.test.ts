import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AUDIO_BUCKET_TYPES,
  AUDIO_LIBRARY_TYPES,
  REPORT_TYPES,
  STORAGE_BUCKETS,
} from '@kit/storage/buckets';

/**
 * KB-55: code wrote to `audio`, `audio-assets` and `videos`, and no
 * migration created any of them, so every upload to them failed on the
 * Supabase provider (local, CI) while working on R2 (production) — nothing
 * that ran before production could see it.
 *
 * This guard binds three things that drifted:
 *   - every bucket name code passes to a storage call is in STORAGE_BUCKETS;
 *   - every name in STORAGE_BUCKETS is created by a migration;
 *   - the MIME lists in @kit/storage/buckets are the buckets' own lists.
 */

const ROOT = path.resolve(__dirname, '../../../../../..');
const MIGRATIONS = path.join(ROOT, 'apps/web/supabase/migrations');
const SOURCE_ROOTS = ['apps/web', 'packages'].map((dir) =>
  path.join(ROOT, dir),
);
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  '__tests__',
]);

/**
 * The one bucket name the code uses that no migration creates and that is
 * not in STORAGE_BUCKETS: the edit-suite export's R2 prefix
 * (`NEXT_PUBLIC_R2_BUCKET_NAME ?? 'storybook-assets'`). FILM-607 retires the
 * Edit Suite and deletes the file, at which point the stale-entry test below
 * fails and this entry must be removed. It is an allowlist rather than a
 * comment so that it cannot outlive its reason.
 */
const REMOVED_BY_FILM_607: Record<string, string> = {
  'storybook-assets': 'packages/features/edit-suite/src/lib/export-upload.ts',
};

/**
 * Shapes in which a bucket name reaches storage as a string literal. The
 * adapter's own methods take (bucket, path, …); Supabase's client takes
 * `.storage.from(bucket)`; the browser helper takes (file, bucket, path).
 */
const BUCKET_LITERALS = [
  /\.storage\s*\.from\(\s*['"]([^'"]+)['"]/g,
  /\.(?:upload|getSignedUploadUrl|delete|read|exists|getPublicUrl)\(\s*['"]([^'"]+)['"]\s*,/g,
  /uploadWithPresignedUrl\(\s*[^,()]+,\s*['"]([^'"]+)['"]/g,
  /\b[A-Z_]*BUCKET[A-Z_]*\s*=\s*['"]([^'"]+)['"]/g,
];

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

/** Source with comment lines blanked, so examples in docs don't count. */
function code(file: string) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => (/^\s*(\*|\/\/|\/\*)/.test(line) ? '' : line))
    .join('\n');
}

function bucketLiterals() {
  const found: Array<{ bucket: string; file: string }> = [];

  for (const file of SOURCE_ROOTS.flatMap(sourceFiles)) {
    const source = code(file);
    for (const pattern of BUCKET_LITERALS) {
      for (const match of source.matchAll(pattern)) {
        found.push({ bucket: match[1]!, file: path.relative(ROOT, file) });
      }
    }
  }

  return found;
}

const migrations = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATIONS, file), 'utf8'));

function createdBuckets(): Set<string> {
  const created = new Set<string>();

  for (const sql of migrations) {
    for (const insert of sql.matchAll(
      /insert\s+into\s+storage\.buckets[\s\S]*?;/gi,
    )) {
      for (const row of insert[0].matchAll(/\(\s*'([^']+)'\s*,\s*'[^']+'/g)) {
        created.add(row[1]!);
      }
    }
  }

  return created;
}

/** The last MIME list any migration gives a bucket, by insert or update. */
function bucketMimeTypes(bucket: string): string[] | null {
  let latest: string[] | null = null;

  for (const sql of migrations) {
    const statements = sql.split(/;\s*\n/);
    for (const statement of statements) {
      if (!/storage\.buckets/i.test(statement)) continue;

      const update = new RegExp(`where\\s+id\\s*=\\s*'${bucket}'`, 'i');
      const insertRow = new RegExp(
        `\\(\\s*'${bucket}'\\s*,[^()]*?array\\[([^\\]]*)\\]`,
        'i',
      );

      const list = update.test(statement)
        ? /allowed_mime_types\s*=\s*array\[([^\]]*)\]/i.exec(statement)?.[1]
        : insertRow.exec(statement)?.[1];

      if (list !== undefined) {
        latest = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
      }
    }
  }

  return latest;
}

describe('storage buckets (KB-55)', () => {
  const buckets: readonly string[] = Object.values(STORAGE_BUCKETS);

  it('the scan finds the storage calls it is meant to find (positive control)', () => {
    const found = bucketLiterals();

    expect(found).toContainEqual({
      bucket: 'project-assets',
      file: 'packages/features/episodes/src/server/thumbnail-actions.ts',
    });
    expect(found).toContainEqual({
      bucket: 'audio',
      file: 'packages/features/audio-generation/src/server/sfx-actions.ts',
    });
    expect(found).toContainEqual({
      bucket: 'reports',
      file: 'packages/features/content-analytics/src/server/report-storage.ts',
    });
  });

  it('every bucket name passed to a storage call is in STORAGE_BUCKETS', () => {
    const unknown = bucketLiterals().filter(
      ({ bucket }) => !buckets.includes(bucket),
    );

    expect(unknown).toEqual([]);
  });

  it('every bucket in STORAGE_BUCKETS is created by a migration', () => {
    const created = createdBuckets();

    expect(buckets.filter((bucket) => !created.has(bucket))).toEqual([]);
  });

  it('the MIME lists in @kit/storage/buckets are the buckets’ own lists', () => {
    expect(bucketMimeTypes(STORAGE_BUCKETS.audio)?.sort()).toEqual(
      [...AUDIO_BUCKET_TYPES].sort(),
    );
    expect(bucketMimeTypes(STORAGE_BUCKETS.audioAssets)?.sort()).toEqual(
      [...AUDIO_LIBRARY_TYPES].sort(),
    );
    expect(bucketMimeTypes(STORAGE_BUCKETS.reports)?.sort()).toEqual(
      [...REPORT_TYPES].sort(),
    );
  });

  describe('temporary exception: storybook-assets (FILM-607)', () => {
    for (const [name, file] of Object.entries(REMOVED_BY_FILM_607)) {
      it(`${name} is still used by ${file}, or this entry is stale`, () => {
        let source = '';
        try {
          source = readFileSync(path.join(ROOT, file), 'utf8');
        } catch {
          // deleted
        }

        expect(
          source.includes(`'${name}'`),
          `stale allowlist entry: FILM-607 has landed, delete REMOVED_BY_FILM_607['${name}']`,
        ).toBe(true);
      });

      it(`${name} is used nowhere else`, () => {
        const elsewhere = SOURCE_ROOTS.flatMap(sourceFiles)
          .filter((f) => path.relative(ROOT, f) !== file)
          .filter((f) => code(f).includes(`'${name}'`))
          .map((f) => path.relative(ROOT, f));

        expect(elsewhere).toEqual([]);
      });
    }
  });
});
