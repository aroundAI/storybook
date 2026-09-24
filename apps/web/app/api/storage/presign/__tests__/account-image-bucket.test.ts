import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { UPLOAD_CONSTRAINTS } from '@kit/assets/upload-validation';

/**
 * KB-53: the presign route admits avatars of UPLOAD_CONSTRAINTS.image's types
 * and size. On Supabase a signed upload URL binds neither, so the
 * `account_image` bucket's own limits must be the same ones. This reads the
 * latest migration that sets them and compares.
 */
const MIGRATIONS = path.resolve(
  __dirname,
  '../../../../../supabase/migrations',
);

function latestAccountImageLimits() {
  const sql = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => readFileSync(path.join(MIGRATIONS, file), 'utf8'))
    .filter(
      (text) =>
        text.includes('allowed_mime_types') &&
        text.includes("where id = 'account_image'"),
    )
    .at(-1);

  if (!sql) {
    throw new Error('No migration sets account_image allowed_mime_types');
  }

  const types = sql.match(/allowed_mime_types\s*=\s*array\[([^\]]*)\]/);
  const size = sql.match(/file_size_limit\s*=\s*(\d+)/);

  if (!types?.[1] || !size?.[1]) {
    throw new Error('Could not read the account_image limits');
  }

  return {
    types: [...types[1].matchAll(/'([^']+)'/g)].map((match) => match[1]!),
    size: Number(size[1]),
  };
}

describe('account_image bucket limits', () => {
  it('allow exactly the image types the route admits', () => {
    expect(latestAccountImageLimits().types.sort()).toEqual(
      [...UPLOAD_CONSTRAINTS.image.allowedTypes].sort(),
    );
  });

  it('cap the size at the image limit', () => {
    expect(latestAccountImageLimits().size).toBe(
      UPLOAD_CONSTRAINTS.image.maxSize,
    );
  });
});
