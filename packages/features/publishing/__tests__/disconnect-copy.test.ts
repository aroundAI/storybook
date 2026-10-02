import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  VENDOR_REVOKES,
  disconnectCopyFor,
} from '../src/components/disconnect-copy';
import type { PlatformType } from '../src/types';

/**
 * KB-25: the disconnect dialog's sentence about revocation, per platform, and
 * that every key it can choose exists in the locale file — a missing key
 * renders as the key itself.
 */
const locale = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../apps/web/public/locales/en/platforms.json'),
    'utf8',
  ),
) as Record<string, unknown>;

function lookup(key: string): unknown {
  return key
    .replace(/^platforms:/, '')
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      locale,
    );
}

const platforms = Object.keys(VENDOR_REVOKES) as PlatformType[];

describe('disconnectCopyFor (KB-25)', () => {
  it('promises a revoke for X', () => {
    expect(disconnectCopyFor('twitter').revokeKey).toBe(
      'platforms:disconnectDialog.revokeAsks',
    );
  });

  it.each(platforms)(
    '%s: every sentence it picks exists in English',
    (platform) => {
      const copy = disconnectCopyFor(platform);

      expect(lookup(copy.revokeKey)).toEqual(expect.any(String));
      expect(lookup(copy.vendorDataKey)).toEqual(expect.any(String));
    },
  );

  it('says nothing is merely "not yet" done', () => {
    expect(JSON.stringify(locale)).not.toMatch(/don't yet|do not yet/i);
    expect(lookup('disconnectToast.revokeUnconfirmed')).toEqual(
      expect.any(String),
    );
  });
});
