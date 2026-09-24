import { describe, expect, it } from 'vitest';

import { VENDOR_REVOKES } from '../src/components/disconnect-copy';
import { PLATFORM_ACCESS_SETTINGS } from '../src/components/platform-access-settings';

/**
 * KB-45: an unconfirmed revoke sends the creator to the platform's settings,
 * so every platform must have somewhere to send them — and the data-deletion
 * page lists the same places.
 */
describe('PLATFORM_ACCESS_SETTINGS', () => {
  it('names a place for every platform the dialog knows', () => {
    expect(Object.keys(PLATFORM_ACCESS_SETTINGS).sort()).toEqual(
      Object.keys(VENDOR_REVOKES).sort(),
    );
  });

  it('links over https, or gives an in-app path where there is no page', () => {
    for (const settings of Object.values(PLATFORM_ACCESS_SETTINGS)) {
      if (settings.href === null) {
        expect(settings.where).toMatch(/^In the .+ app: /);
      } else {
        expect(new URL(settings.href).protocol).toBe('https:');
      }
    }
  });

  it('gives each row a distinct data-test id', () => {
    const ids = Object.values(PLATFORM_ACCESS_SETTINGS).map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
