import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-607. The Edit Suite is retired (owner, 2026-09-23). This fails if any
 * of its names comes back in application or infrastructure code: the
 * package, the route, the render worker and its queues, the five database
 * functions, the collaborative-editing WebSocket messages.
 *
 * Migration history is excluded because it is history: the migrations that
 * created these objects stay, and the ones that removed them name them. The
 * generated types are excluded because they are generated from the
 * database, which pgTAP checks directly. Specs and plans describe the
 * retirement, so they are not scanned either.
 *
 * FILM-608 extends this list with the six edit tables once they are dropped.
 */
const REPO = join(__dirname, '..', '..', '..');

export const RETIRED_NAMES = [
  '@kit/edit-suite',
  'features/edit-suite',
  'episodeSlug]/edit-suite',
  'render-worker',
  'StorybookRenderQueue',
  'StorybookRenderDLQ',
  'RENDER_QUEUE_URL',
  'ffmpeg-static',
  'EXPORT_UPLOAD_BUCKET',
  'batch_assemble_edit_project',
  'batch_save_edit_project',
  'create_edit_project_with_tracks',
  'split_edit_clip',
  'get_project_id_for_edit_project',
  "'edit-operation'",
  "'cursor-update'",
  'render-status-changed',
];

const ROOTS = ['apps', 'packages', 'tooling', 'scripts', '.github'];
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
  'apps/web/lib/database.types.ts',
  'packages/supabase/src/database.types.ts',
  // This file, and the pgTAP test and guards that prove the functions gone.
  'apps/web/test/film-607-edit-suite-retired.test.ts',
  'apps/web/supabase/tests/database/edit-suite-retired.test.sql',
  'tooling/mutation-guards/film-607.json',
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

describe('FILM-607: the Edit Suite stays retired', () => {
  it('finds a retired name when one is present (positive control)', () => {
    expect(
      findRetiredNames([
        {
          path: 'fixture.ts',
          source: "import x from '@kit/edit-suite/components';",
        },
      ]),
    ).toEqual(['fixture.ts:1 @kit/edit-suite']);
  });

  it('no application or infrastructure file names the Edit Suite', () => {
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
