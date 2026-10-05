import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-607 and FILM-608. The Edit Suite is retired (owner, 2026-09-23). This
 * fails if any of its names comes back anywhere in the repository: the
 * package, the route, the render worker and its queues, the five database
 * functions, the collaborative-editing WebSocket messages, and (FILM-608)
 * the six tables, `compilations.edit_project_id` and the schema file.
 *
 * Migration history is excluded because it is history: the migrations that
 * created these objects stay, and the ones that removed them name them.
 * Specs and plans describe the retirement, so they are not scanned either.
 * The generated types are scanned: once the tables are dropped, a types
 * file that still lists them was not regenerated.
 *
 * `render_status` and `render_url` were columns of `edit_projects`. If a
 * future feature needs either name, narrow the entry rather than skip it.
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
  'edit_projects',
  'edit_tracks',
  'edit_clips',
  'edit_keyframes',
  'edit_transitions',
  'dialogue_sync_groups',
  'edit_project_id',
  'render_status',
  'render_url',
  '36-edit-suite',
];

// Every top-level directory is scanned except these: version control, other
// worktrees and local tool state, the specs, which record the retirement, and
// the StorybookStudio submodule: a separate repository that CI never checks
// out, so a populated checkout (a local-CI worktree) would scan an editor
// that legitimately names ffmpeg-static (72 hits on #630, 2026-10-05).
const SKIPPED_ROOTS = new Set([
  '.git',
  '.claude',
  '.local-ci',
  '.sst', // SST build artifacts: old Lambda bundles that still name the retired tables
  'node_modules',
  'specs',
  'storybookstudio',
]);

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
  // This file, and the pgTAP test and guards that prove the objects gone.
  'apps/web/test/film-607-edit-suite-retired.test.ts',
  'apps/web/supabase/tests/database/edit-suite-retired.test.sql',
  'tooling/mutation-guards/film-607.json',
  'tooling/mutation-guards/film-608.json',
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
    const files = readdirSync(REPO, { withFileTypes: true })
      .flatMap((entry) => {
        const path = join(REPO, entry.name);

        if (entry.isDirectory()) {
          return SKIPPED_ROOTS.has(entry.name) ? [] : sourceFiles(path);
        }

        return SOURCE.test(entry.name) ? [path] : [];
      })
      .map((path) => relative(REPO, path))
      .filter((path) => !SKIPPED_FILES.has(path))
      .map((path) => ({
        path,
        source: readFileSync(join(REPO, path), 'utf8'),
      }));

    expect(files.length).toBeGreaterThan(500);
    expect(findRetiredNames(files)).toEqual([]);
  }, 30_000);
});
