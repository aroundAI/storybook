import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-73: the audio library sent the whole file as base64 in a server-action
 * body. Next refuses an action body over 1 MB (base64 adds a third, so ~750 KB
 * of audio), and a Lambda refuses a request over 6 MB, while the dialog
 * allowed 50 MB. Files go to storage through the presign route instead.
 *
 * So: the upload dialog reads no bytes of the file, and no server action in
 * `@kit/audio-generation` has a schema field that carries them.
 */

const ROOT = resolve(__dirname, '../../../../../..');
const DIALOG = join(
  ROOT,
  'apps/web/app/home/[account]/studio/[projectSlug]/audio-library/_components/upload-audio-dialog.tsx',
);
const SERVER = join(ROOT, 'packages/features/audio-generation/src/server');

/** What reading a File's bytes in the browser looks like */
const READS_BYTES =
  /\.arrayBuffer\(|FileReader|toString\(\s*['"]base64['"]|\bbtoa\(|readAsDataURL/;

/** A zod field meant to carry a file's contents (a size in bytes is not) */
const BYTES_FIELD =
  /\b\w*(?:Base64|Buffer|DataUrl|(?<!Size)Bytes)\s*:\s*z\.|z\.instanceof\(\s*(?:File|Blob|Buffer)/i;

function serverModules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return serverModules(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('audio library uploads carry no file bytes through a server action', () => {
  it('the upload dialog reads no bytes of the file', () => {
    const source = readFileSync(DIALOG, 'utf8');

    expect(source).toContain('uploadWithPresignedUrl');
    expect(source).not.toMatch(READS_BYTES);
  });

  it("no 'use server' module in @kit/audio-generation takes a file's bytes", () => {
    const actions = serverModules(SERVER).filter((file) =>
      /^\s*['"]use server['"]/.test(readFileSync(file, 'utf8')),
    );

    expect(actions.length).toBeGreaterThan(5);

    const offenders = actions.filter((file) =>
      BYTES_FIELD.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});
