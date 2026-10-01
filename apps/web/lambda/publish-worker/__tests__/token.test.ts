import type { SupabaseClient } from '@supabase/supabase-js';

import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encrypt } from '@kit/shared/crypto';

import { checkConnectionToken } from '../token';

/**
 * KB-15. The publish worker never refreshes a token: the web app's cron does.
 * So it must refuse exactly what the app would refresh before use, or a
 * scheduled publish starts with a token the app already considers spent. The
 * token is encrypted by the app's `@kit/shared/crypto` and decrypted by the
 * worker's own copy, so this also pins the two formats together.
 */

const NOW = new Date('2026-09-23T12:00:00.000Z');

function fakeClient(row: Record<string, unknown> | null) {
  const query = {
    select: () => query,
    eq: () => query,
    single: async () => ({
      data: row,
      error: row ? null : { code: 'PGRST116', message: 'no rows' },
    }),
  };

  return { from: () => query } as unknown as SupabaseClient;
}

async function xConnection(minutesLeft: number, isActive = true) {
  return {
    id: 'conn-x',
    platform: 'twitter',
    platform_account_id: 'x-user-1',
    platform_account_name: 'x_user',
    access_token_encrypted: await encrypt('x-access-token'),
    token_expires_at: new Date(
      NOW.getTime() + minutesLeft * 60_000,
    ).toISOString(),
    is_active: isActive,
  };
}

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_KEY', randomBytes(32).toString('base64'));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('checkConnectionToken', () => {
  it('hands out an X token the app would use as it is', async () => {
    const client = fakeClient(await xConnection(120));

    expect(await checkConnectionToken('conn-x', client, NOW)).toEqual({
      valid: true,
      accessToken: 'x-access-token',
      platformAccountId: 'x-user-1',
    });
  });

  it('refuses an X token the app would refresh first', async () => {
    const client = fakeClient(await xConnection(4));

    expect(await checkConnectionToken('conn-x', client, NOW)).toEqual({
      valid: false,
      error: 'EXPIRED',
    });
  });

  // KB-157: a code, which `TokenRefusal` words for the person
  it('refuses with a token code, never with text for the page', async () => {
    expect(
      await checkConnectionToken(
        'conn-x',
        fakeClient(await xConnection(-1)),
        NOW,
      ),
    ).toEqual({ valid: false, error: 'EXPIRED' });

    expect(
      await checkConnectionToken(
        'conn-x',
        fakeClient(await xConnection(120, false)),
        NOW,
      ),
    ).toEqual({ valid: false, error: 'CONNECTION_INACTIVE' });

    expect(await checkConnectionToken('conn-x', fakeClient(null), NOW)).toEqual(
      { valid: false, error: 'NOT_FOUND' },
    );

    expect(
      await checkConnectionToken(
        'conn-x',
        fakeClient({
          ...(await xConnection(120)),
          access_token_encrypted: 'not-a-ciphertext',
        }),
        NOW,
      ),
    ).toEqual({ valid: false, error: 'TOKEN_UNREADABLE' });
  });
});
