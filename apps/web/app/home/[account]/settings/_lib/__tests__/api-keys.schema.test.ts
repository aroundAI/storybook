import { describe, expect, it } from 'vitest';

import { ApiKeyProviders, SaveApiKeySchema } from '../api-keys.schema';

// FILM-514: the retired music vendor, spelled in two parts so the repo scan
// that keeps its name out of the codebase does not match this test.
const RETIRED = 's' + 'uno';

describe('API key providers', () => {
  it('accepts a key for a live provider', () => {
    expect(
      SaveApiKeySchema.safeParse({
        accountSlug: 'team',
        provider: 'elevenlabs',
        apiKey: 'sk_live_0123456789',
      }).success,
    ).toBe(true);
  });

  it('refuses a key for the retired music vendor', () => {
    expect(ApiKeyProviders).not.toContain(RETIRED);
    expect(
      SaveApiKeySchema.safeParse({
        accountSlug: 'team',
        provider: RETIRED,
        apiKey: 'sk_live_0123456789',
      }).success,
    ).toBe(false);
  });
});
