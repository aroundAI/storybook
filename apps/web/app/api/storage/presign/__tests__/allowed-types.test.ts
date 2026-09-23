import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ALLOWED_PROJECT_ASSET_TYPES } from '@kit/assets/upload-validation';

/**
 * KB-28: the presign route refuses types outside ALLOWED_PROJECT_ASSET_TYPES,
 * and the `project-assets` bucket refuses types outside its
 * `allowed_mime_types`. The two lists must be the same list, so this reads
 * the latest migration that sets the bucket's types and compares.
 */
const MIGRATIONS = path.resolve(
  __dirname,
  '../../../../../supabase/migrations',
);

function bucketMimeTypesFromMigrations(): string[] {
  const setting = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => readFileSync(path.join(MIGRATIONS, file), 'utf8'))
    .filter(
      (sql) =>
        sql.includes('allowed_mime_types') &&
        sql.includes("where id = 'project-assets'"),
    )
    .at(-1);

  if (!setting) {
    throw new Error('No migration sets project-assets allowed_mime_types');
  }

  const list = setting.match(/allowed_mime_types\s*=\s*array\[([^\]]*)\]/);

  if (!list?.[1]) {
    throw new Error('Could not read the allowed_mime_types array');
  }

  return [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

describe('ALLOWED_PROJECT_ASSET_TYPES', () => {
  it('is exactly the project-assets bucket allowed_mime_types', () => {
    expect([...ALLOWED_PROJECT_ASSET_TYPES].sort()).toEqual(
      bucketMimeTypesFromMigrations().sort(),
    );
  });

  it('admits the audio type every server-side audio uploader sends', () => {
    expect(ALLOWED_PROJECT_ASSET_TYPES).toContain('audio/mpeg');
  });
});
