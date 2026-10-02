import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { GENERATION_JOB_TYPES } from '../src/lib/generation-job-types';

/**
 * KB-174: batchCreateAssetsAction inserted `job_type: 'asset_creation'`, a
 * value generation_jobs_job_type_check did not allow, and the failed insert
 * was logged at warn and forgotten. KB-14 was the same bug for the two
 * refinement types. Three things must agree: the CHECK as the latest
 * migration leaves it, the TypeScript list, and every value a producer
 * inserts.
 */

const REPO = path.resolve(__dirname, '../../../..');
const MIGRATIONS = path.join(REPO, 'apps/web/supabase/migrations');
const SCHEMA_MIRROR = path.join(
  REPO,
  'apps/web/supabase/schemas/30-film-studio.sql',
);

/** The quoted values of the last `check (job_type in (…))` in `sql`, if any. */
function jobTypeCheckValues(sql: string): string[] | null {
  const checks = [
    ...sql.matchAll(/check\s*\(\s*job_type\s+in\s*\(([^)]*)\)/gi),
  ];
  const last = checks.at(-1);
  if (!last) return null;
  return [...last[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

function latestCheckInMigrations(): { file: string; values: string[] } {
  const defining = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((file) => ({
      file,
      values: jobTypeCheckValues(
        readFileSync(path.join(MIGRATIONS, file), 'utf8'),
      ),
    }))
    .filter((m): m is { file: string; values: string[] } => m.values !== null);

  expect(defining.length).toBeGreaterThan(0);
  return defining.at(-1)!;
}

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (
      name === 'node_modules' ||
      name === '__tests__' ||
      name === '.next' ||
      name === 'dist' ||
      name === '.turbo'
    ) {
      continue;
    }
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      yield* sourceFiles(full);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      yield full;
    }
  }
}

/** Every `job_type: '<value>'` a producer writes, with where it writes it. */
function insertedJobTypes(): Array<{ file: string; value: string }> {
  const found: Array<{ file: string; value: string }> = [];
  for (const root of ['packages', 'apps/web/lambda']) {
    for (const file of sourceFiles(path.join(REPO, root))) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/\bjob_type:\s*'([^']+)'/g)) {
        found.push({ file: path.relative(REPO, file), value: m[1]! });
      }
    }
  }
  return found;
}

describe('GENERATION_JOB_TYPES', () => {
  it('is the CHECK as the latest migration leaves it', () => {
    const { file, values } = latestCheckInMigrations();

    expect([...values].sort(), `check in ${file}`).toEqual(
      [...GENERATION_JOB_TYPES].sort(),
    );
  });

  it('is what the schema mirror says', () => {
    const values = jobTypeCheckValues(readFileSync(SCHEMA_MIRROR, 'utf8'));

    expect(values).not.toBeNull();
    expect([...values!].sort()).toEqual([...GENERATION_JOB_TYPES].sort());
  });

  it('allows every job_type a producer inserts', () => {
    const inserted = insertedJobTypes();
    const allowed = new Set<string>(GENERATION_JOB_TYPES);

    // Positive control: the scan sees the producers.
    expect(inserted.map((i) => i.value)).toContain('asset_creation');
    expect(inserted.map((i) => i.value)).toContain('story-refinement');

    const refused = inserted.filter((i) => !allowed.has(i.value));
    expect(refused).toEqual([]);
  });
});
