import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-189: every file the edit package lists carries a SHA-256 recorded when
 * it was written. Server writers cannot forget it: `writeProjectObject` and
 * the workers' `uploadToR2` take the client it is recorded on as a required
 * argument. A browser upload is a presigned PUT the server never sees, so
 * the uploader itself must report it (`recordUploadChecksum`).
 *
 * `uploadWithPresignedUrl` does so for its callers. This fails when code
 * presigns an upload itself and does not.
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

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.(ts|tsx)$/.test(name)) return [];
    if (/\.(test|spec)\.[a-z]+$/.test(name)) return [];
    return [full];
  });
}

const files = SOURCE_ROOTS.flatMap(sourceFiles).map((file) => ({
  file: path.relative(ROOT, file),
  source: readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => (/^\s*(\*|\/\/|\/\*)/.test(line) ? '' : line))
    .join('\n'),
}));

describe('browser uploads record their checksum (KB-189)', () => {
  it('uploadWithPresignedUrl records what it PUT', () => {
    const client = files.find(
      (f) =>
        f.file === 'packages/features/storage/src/client/presigned-upload.ts',
    )!;
    const body = client.source.slice(
      client.source.indexOf('export async function uploadWithPresignedUrl('),
    );

    expect(body).toMatch(
      /await recordUploadChecksum\(file, bucket, path\);[\s\S]*return \{/,
    );
  });

  it('every other uploader that presigns its own PUT records it too', () => {
    const presigners = files.filter(
      (f) =>
        /\brequestPresignedUpload\(/.test(f.source) &&
        f.file !== 'packages/features/storage/src/client/presigned-upload.ts',
    );

    expect(presigners.map((f) => f.file).sort()).toEqual([
      'packages/features/assets/src/components/image-uploader/use-image-upload.ts',
      'packages/features/episodes/src/hooks/use-video-upload.ts',
    ]);

    for (const { file, source } of presigners) {
      expect(
        (source.match(/\brequestPresignedUpload\(/g) ?? []).length,
        `${file} records a checksum for each upload it presigns`,
      ).toBe((source.match(/\brecordUploadChecksum\(/g) ?? []).length);
    }
  });
});
