import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-30. The bug was a fallback spelled at each upload site —
 * `(… .madeForKids as boolean) ?? false`, `(… .categoryId as string) ?? '22'` —
 * four times across three files. The resolver replaced them; this keeps a
 * fifth from being written next to a new upload path.
 */

const ROOT = join(__dirname, '../../../..');

const UPLOAD_SITES = [
  'packages/features/publishing/src/server/publish-actions.ts',
  'packages/features/publishing/src/server/youtube-upload.ts',
  'packages/features/publishing/src/jobs/process-scheduled-publishes.ts',
  'packages/features/publishing/src/providers/youtube/youtube-provider.ts',
  'apps/web/lambda/publish-worker/handlers/youtube.ts',
];

const FALLBACKS = [
  /madeForKids[^\n;]*\?\?/,
  /selfDeclaredMadeForKids[^\n;]*\?\?/,
  /categoryId[^\n;]*\?\?\s*['"]\d+['"]/,
];

describe('YouTube upload sites declare nothing on the creator’s behalf', () => {
  it.each(UPLOAD_SITES)('%s has no audience or category fallback', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');

    for (const fallback of FALLBACKS) {
      expect(source, `${file} matches ${fallback}`).not.toMatch(fallback);
    }
  });

  it('the patterns catch the shape the bug had (positive control)', () => {
    const before = `categoryId: (job.metadata.categoryId as string) ?? '22',
      madeForKids: (job.metadata.madeForKids as boolean) ?? false,`;

    expect(FALLBACKS.some((fallback) => fallback.test(before))).toBe(true);
    expect(before).toMatch(FALLBACKS[0]!);
    expect(before).toMatch(FALLBACKS[2]!);
  });
});
