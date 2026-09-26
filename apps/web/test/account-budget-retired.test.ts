import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The account budget machinery is removed (owner, 2026-09-25: "Remove the
 * budget machinery"). This fails if any of its names comes back in
 * application or infrastructure code: the three database functions, the two
 * `accounts` columns, and the TypeScript helpers that called them.
 *
 * Migration history is excluded because it is history: the migrations that
 * created these objects stay, and the one that removed them names them. The
 * generated types are excluded because they are generated from the
 * database, which pgTAP checks directly (account-budget-retired.test.sql).
 * Specs and plans describe the removal, so they are not scanned either.
 */
const REPO = join(__dirname, '..', '..', '..');

export const RETIRED_NAMES = [
  'check_account_budget',
  'increment_account_usage',
  'reset_monthly_usage',
  'current_usage_cents',
  'monthly_budget_cents',
  'checkAccountBudget',
  'recordVoiceSpend',
];

const ROOTS = ['apps', 'packages', 'tooling', 'scripts', '.github'];
const FILES = ['sst.config.ts', 'package.json', 'turbo.json'];

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
  // This file, and the pgTAP test and guards that prove the objects gone.
  'apps/web/test/account-budget-retired.test.ts',
  'apps/web/supabase/tests/database/account-budget-retired.test.sql',
  'tooling/mutation-guards/account-budget-retired.json',
]);

const SOURCE = /\.(ts|tsx|js|mjs|cjs|json|sql|ya?ml|sh|py)$/;

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
    source
      .split('\n')
      .flatMap((line, index) =>
        RETIRED_NAMES.filter((name) => line.includes(name)).map(
          (name) => `${path}:${index + 1} ${name}`,
        ),
      ),
  );
}

describe('The account budget stays removed', () => {
  it('finds a retired name when one is present (positive control)', () => {
    expect(
      findRetiredNames([
        {
          path: 'fixture.ts',
          source: "await client.rpc('check_account_budget', args);",
        },
      ]),
    ).toEqual(['fixture.ts:1 check_account_budget']);
  });

  it('no application or infrastructure file names the budget machinery', () => {
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
