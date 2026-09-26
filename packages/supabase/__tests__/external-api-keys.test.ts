import type { SupabaseClient } from '@supabase/supabase-js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/database.types';
import {
  canManageExternalApiKeys,
  readExternalApiKey,
  readExternalApiKeys,
  removeExternalApiKey,
  storeExternalApiKey,
} from '../src/external-api-keys';

/**
 * KB-84. The helper reads and stores ciphertext with the admin client, which
 * skips RLS, so the caller's own `has_account_access` answer is the only
 * thing between a browser-supplied account id and another account's key.
 */

const admin = vi.hoisted(() => ({
  from: vi.fn(),
  calls: [] as Array<[string, ...unknown[]]>,
  result: { data: [] as unknown[], error: null as unknown },
  upsertError: null as unknown,
}));

vi.mock('../src/clients/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({ from: admin.from }),
}));

function adminQuery() {
  const query = {
    select: (...args: unknown[]) => {
      admin.calls.push(['select', ...args]);
      return query;
    },
    eq: (...args: unknown[]) => {
      admin.calls.push(['eq', ...args]);
      return query;
    },
    order: (...args: unknown[]) => {
      admin.calls.push(['order', ...args]);
      return Promise.resolve(admin.result);
    },
    upsert: (...args: unknown[]) => {
      admin.calls.push(['upsert', ...args]);
      return Promise.resolve({ error: admin.upsertError });
    },
  };

  return query;
}

function callerWithAccess(answer: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => answer);

  return {
    rpc,
    client: { rpc } as unknown as SupabaseClient<Database>,
  };
}

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const ROW = { provider: 'elevenlabs', encrypted_key: 'enc', is_active: true };

beforeEach(() => {
  admin.calls = [];
  admin.result = { data: [ROW], error: null };
  admin.upsertError = null;
  admin.from.mockReset().mockImplementation((table: string) => {
    admin.calls.push(['from', table]);
    return adminQuery();
  });
});

describe('readExternalApiKeys (KB-84)', () => {
  it('asks has_account_access on the caller’s client for the account it reads', async () => {
    const { client, rpc } = callerWithAccess({ data: true, error: null });

    await readExternalApiKeys(client, ACCOUNT);

    expect(rpc).toHaveBeenCalledWith('has_account_access', {
      p_account_id: ACCOUNT,
    });
  });

  it('reads nothing with the admin client for a caller without access to the account', async () => {
    const { client } = callerWithAccess({ data: false, error: null });

    await expect(readExternalApiKeys(client, ACCOUNT)).resolves.toEqual([]);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('fails closed when the access check itself errors', async () => {
    const { client } = callerWithAccess({
      data: null,
      error: { message: 'boom' },
    });

    await expect(readExternalApiKeys(client, ACCOUNT)).rejects.toThrow(
      'api_key_access_check',
    );
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('reads the account’s keys through the admin client once access is proved', async () => {
    const { client } = callerWithAccess({ data: true, error: null });

    await expect(readExternalApiKeys(client, ACCOUNT)).resolves.toEqual([ROW]);
    expect(admin.calls).toEqual([
      ['from', 'external_api_keys'],
      ['select', 'provider, encrypted_key, is_active'],
      ['eq', 'account_id', ACCOUNT],
      ['order', 'provider'],
    ]);
  });

  it('filters by provider and active state when asked', async () => {
    const { client } = callerWithAccess({ data: true, error: null });

    await readExternalApiKeys(client, ACCOUNT, {
      provider: 'elevenlabs',
      activeOnly: true,
    });

    expect(admin.calls).toContainEqual(['eq', 'provider', 'elevenlabs']);
    expect(admin.calls).toContainEqual(['eq', 'is_active', true]);
  });

  it('throws a read error rather than reporting no key', async () => {
    const { client } = callerWithAccess({ data: true, error: null });
    admin.result = {
      data: null as unknown as unknown[],
      error: new Error('db'),
    };

    await expect(readExternalApiKeys(client, ACCOUNT)).rejects.toThrow('db');
  });
});

describe('readExternalApiKey (KB-84)', () => {
  it('returns the one provider’s active key', async () => {
    const { client } = callerWithAccess({ data: true, error: null });

    await expect(
      readExternalApiKey(client, ACCOUNT, 'elevenlabs'),
    ).resolves.toEqual(ROW);
    expect(admin.calls).toContainEqual(['eq', 'is_active', true]);
  });

  it('can include an inactive key', async () => {
    const { client } = callerWithAccess({ data: true, error: null });

    await readExternalApiKey(client, ACCOUNT, 'elevenlabs', {
      activeOnly: false,
    });

    expect(admin.calls).not.toContainEqual(['eq', 'is_active', true]);
  });

  it('returns null when no key is stored, or the caller may not see it', async () => {
    const stored = callerWithAccess({ data: true, error: null });
    admin.result = { data: [], error: null };
    await expect(
      readExternalApiKey(stored.client, ACCOUNT, 'elevenlabs'),
    ).resolves.toBeNull();

    const stranger = callerWithAccess({ data: false, error: null });
    await expect(
      readExternalApiKey(stranger.client, ACCOUNT, 'elevenlabs'),
    ).resolves.toBeNull();
  });
});

/** A caller whose owner RPCs answer as given; records the delete it runs. */
function callerWithOwnership(answer: {
  primary?: boolean;
  role?: boolean;
  error?: unknown;
}) {
  const deletes: unknown[][] = [];
  const rpc = vi.fn(async (fn: string) => ({
    data: fn === 'is_account_owner' ? !!answer.primary : !!answer.role,
    error: answer.error ?? null,
  }));
  const deleteChain = {
    eq: (...args: unknown[]) => {
      deletes.push(['eq', ...args]);
      return deleteChain;
    },
    then: (resolve: (value: { error: null }) => void) =>
      resolve({ error: null }),
  };
  const from = vi.fn((table: string) => ({
    delete: () => {
      deletes.push(['delete', table]);
      return deleteChain;
    },
  }));

  return {
    rpc,
    deletes,
    client: { rpc, from } as unknown as SupabaseClient<Database>,
  };
}

describe('canManageExternalApiKeys (KB-84, owner decision 2026-09-25)', () => {
  it('is true for the primary owner (a personal account has no membership row)', async () => {
    const { client, rpc } = callerWithOwnership({ primary: true });

    await expect(canManageExternalApiKeys(client, ACCOUNT)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('is_account_owner', {
      account_id: ACCOUNT,
    });
  });

  it('is true for a member holding the owner role', async () => {
    const { client, rpc } = callerWithOwnership({ role: true });

    await expect(canManageExternalApiKeys(client, ACCOUNT)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('has_role_on_account', {
      account_id: ACCOUNT,
      account_role: 'owner',
    });
  });

  it('is false for any other role on the account', async () => {
    const { client } = callerWithOwnership({});

    await expect(canManageExternalApiKeys(client, ACCOUNT)).resolves.toBe(
      false,
    );
  });

  it('throws when the check itself errors', async () => {
    const { client } = callerWithOwnership({ error: { message: 'boom' } });

    await expect(canManageExternalApiKeys(client, ACCOUNT)).rejects.toThrow(
      'api_key_owner_check',
    );
  });
});

describe('storeExternalApiKey (KB-84)', () => {
  const INSERT = {
    account_id: ACCOUNT,
    provider: 'hailuo',
    encrypted_key: 'enc-new',
    is_active: true,
    last_used_at: null,
  };

  it('writes nothing for a member who is not an owner of the account the row names', async () => {
    const { client, rpc } = callerWithOwnership({});

    await expect(storeExternalApiKey(client, INSERT)).resolves.toEqual({
      error: { branch: 'api_key_owner_check', cause: null },
    });
    expect(rpc).toHaveBeenCalledWith('has_role_on_account', {
      account_id: ACCOUNT,
      account_role: 'owner',
    });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('writes nothing when the owner check errors', async () => {
    const { client } = callerWithOwnership({ error: { message: 'boom' } });

    const { error } = await storeExternalApiKey(client, INSERT);

    expect(error?.branch).toBe('api_key_owner_check');
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('upserts on (account_id, provider) with the admin client for an owner', async () => {
    const { client } = callerWithOwnership({ role: true });

    await expect(storeExternalApiKey(client, INSERT)).resolves.toEqual({
      error: null,
    });
    expect(admin.calls).toEqual([
      ['from', 'external_api_keys'],
      ['upsert', INSERT, { onConflict: 'account_id,provider' }],
    ]);
  });

  it('reports an upsert failure', async () => {
    const { client } = callerWithOwnership({ primary: true });
    admin.upsertError = { message: 'nope' };

    await expect(storeExternalApiKey(client, INSERT)).resolves.toEqual({
      error: { branch: 'api_key_upsert', cause: { message: 'nope' } },
    });
  });
});

describe('removeExternalApiKey (KB-84)', () => {
  it('deletes nothing for a member who is not an owner', async () => {
    const { client, deletes } = callerWithOwnership({});

    await expect(
      removeExternalApiKey(client, ACCOUNT, 'hailuo'),
    ).resolves.toEqual({
      error: { branch: 'api_key_owner_check', cause: null },
    });
    expect(deletes).toEqual([]);
  });

  it('deletes the one provider’s row on the caller’s own client for an owner', async () => {
    const { client, deletes } = callerWithOwnership({ primary: true });

    await expect(
      removeExternalApiKey(client, ACCOUNT, 'hailuo'),
    ).resolves.toEqual({ error: null });
    expect(deletes).toEqual([
      ['delete', 'external_api_keys'],
      ['eq', 'account_id', ACCOUNT],
      ['eq', 'provider', 'hailuo'],
    ]);
    expect(admin.from).not.toHaveBeenCalled();
  });
});
