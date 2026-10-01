import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1710. Instagram's duration can only come from the file we uploaded,
 * so every path that uploads one and marks the publish published must also
 * record that file's length — a path that skips it leaves its rows
 * `duration_unknown` for ever, silently (the `revenue_cents` class of
 * defect the spec names).
 *
 * An upload site is recognised by the write that follows a successful
 * upload: `platform_content_id` taken from the upload's result. The
 * manual "already posted" path (`upload-only-actions.ts`) records a link to
 * a file it never held, so it has no such write and nothing to measure.
 */

const ROOT = resolve(__dirname, '../../../..');
const SEARCHED = ['packages/features/publishing/src', 'apps/web/lambda'];

const UPLOAD_WRITE =
  /platform_content_id:\s*(?:uploadResult|result)\.contentId/g;
const RECORDED = /recordUploadedFileDuration\(/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (name === 'node_modules' || name === '__tests__') return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);

    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const sites = SEARCHED.flatMap((dir) => sourceFiles(join(ROOT, dir)))
  .map((path) => {
    const source = readFileSync(path, 'utf8');

    return {
      file: relative(ROOT, path),
      uploads: source.match(UPLOAD_WRITE)?.length ?? 0,
      recorded: source.match(RECORDED)?.length ?? 0,
    };
  })
  .filter((site) => site.uploads > 0);

describe('every upload path records the uploaded file’s duration', () => {
  it('finds the four upload paths (positive control)', () => {
    expect(sites.map((site) => site.file).sort()).toEqual([
      'apps/web/lambda/publish-worker/index.ts',
      'packages/features/publishing/src/jobs/process-scheduled-publishes.ts',
      'packages/features/publishing/src/server/publish-actions.ts',
    ]);
    expect(sites.reduce((n, site) => n + site.uploads, 0)).toBe(4);
  });

  it.each(sites.map((site) => [site.file, site]))(
    '%s records it once per upload',
    (_file, site) => {
      expect(site.recorded).toBe(site.uploads);
    },
  );
});
