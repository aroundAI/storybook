import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MAX_VIDEO_UPLOAD_BYTES, formatUploadSize } from '../src/upload-limits';

/**
 * FILM-2212. The video upload limit was 500 MB, written out in five places
 * (the Publish screen's dialog, the shot uploader, the presign route's
 * categories, MCP's request_episode_video_upload and request_render_upload),
 * so raising it meant finding them all. It is one constant now, and this
 * fails if a source file writes the old limit out again.
 */

const REPO = resolve(__dirname, '../../..');
const ROOTS = ['packages', 'apps'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  '.open-next',
  '.sst',
  'dist',
  'coverage',
  'test-results',
]);
const SOURCE = /\.(?:ts|tsx|js|mjs|cjs)$/;
const TEST_FILE =
  /(?:^|\/)(?:__tests__|__mocks__|e2e)\/|\.(?:test|spec)\.[jt]sx?$/;

/** `500 * 1024 * 1024`, `524288000`, `500MB`, `500 MB` */
const OLD_LIMIT = /500\s*\*\s*1024\s*\*\s*1024|524_?288_?000|\b500\s?MB\b/gi;

function sourceFiles(path: string): string[] {
  const absolute = join(REPO, path);
  if (!statSync(absolute).isDirectory()) return SOURCE.test(path) ? [path] : [];
  return readdirSync(absolute).flatMap((entry) =>
    SKIP_DIRS.has(entry) ? [] : sourceFiles(join(path, entry)),
  );
}

const FILES = ROOTS.flatMap(sourceFiles)
  .map((file) => relative(REPO, join(REPO, file)).split(sep).join('/'))
  .filter((file) => !TEST_FILE.test(file));

describe('one video upload limit (FILM-2212)', () => {
  it('is what one PUT to R2 carries: 5 GiB less 5 MiB', () => {
    expect(MAX_VIDEO_UPLOAD_BYTES).toBe(5_363_466_240);
    expect(formatUploadSize(MAX_VIDEO_UPLOAD_BYTES)).toBe('4.99 GB');
    expect(formatUploadSize(10 * 1024 * 1024)).toBe('10 MB');
  });

  it('reads the source it scans, so no finding means clean, not unread', () => {
    expect(FILES).toContain('packages/shared/src/upload-limits/index.ts');
    expect(FILES.some((file) => file.endsWith('upload-video-dialog.tsx'))).toBe(
      true,
    );
  });

  it('is not written out as the old 500 MB anywhere', () => {
    const found = FILES.flatMap((file) => {
      const source = readFileSync(join(REPO, file), 'utf8');

      return [...source.matchAll(OLD_LIMIT)].map(
        (match) =>
          `${file}:${source.slice(0, match.index).split('\n').length}: ${match[0]}`,
      );
    });

    expect(found).toEqual([]);
  });
});
