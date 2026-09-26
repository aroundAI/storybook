import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PLATFORMS,
  PLATFORMS_DELETED_ON_UNPUBLISH,
  PLATFORM_NAMES,
} from '../src/lib/platforms';

/**
 * KB-119. The "Delete All" dialog said videos on platforms "will need to be
 * deleted manually", while the publish worker deleted them on YouTube and
 * Facebook. The dialog now words itself from `PLATFORMS_DELETED_ON_UNPUBLISH`;
 * this keeps that list equal to the platforms the worker can delete on.
 */

const HANDLERS = join(
  __dirname,
  '../../../../apps/web/lambda/publish-worker/handlers',
);

function platformsWithDeleteHandler(): string[] {
  return readdirSync(HANDLERS)
    .filter((file) => file.endsWith('.ts'))
    .filter((file) =>
      /export async function deleteFrom\w+\(/.test(
        readFileSync(join(HANDLERS, file), 'utf8'),
      ),
    )
    .map((file) => file.replace(/\.ts$/, ''))
    .sort();
}

describe('what unpublishing deletes on the platform (KB-119)', () => {
  it('is exactly the platforms the publish worker has a delete handler for', () => {
    expect([...PLATFORMS_DELETED_ON_UNPUBLISH].sort()).toEqual(
      platformsWithDeleteHandler(),
    );
  });

  it('names every platform', () => {
    for (const platform of PLATFORMS) {
      expect(PLATFORM_NAMES[platform]).toBeTruthy();
    }
  });
});
