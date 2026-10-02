import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertAccountAccess,
  assertProjectAccess,
  assertScopeAccess,
} from '../src/server/scope-access';

/**
 * FILM-1615 EDD, Step 0 (F-0). Reading a project's row is not proof of
 * access — a public or unlisted project is readable by any signed-in user —
 * so every analytics read by project or account goes through
 * `has_account_access`. Reproduced before this fix: another account's user
 * read a public project's median views by rewriting a Deep Dive request.
 */

const state: {
  /** What the RLS-scoped `projects` read returns (public ones included). */
  project: { account_id: string } | null;
  /** What `has_account_access` answers. */
  hasAccess: boolean;
  rpcError: { message: string } | null;
  connection: { id: string; account_id: string } | null;
  rpcCalls: Array<{ name: string; args: unknown }>;
} = {
  project: null,
  hasAccess: false,
  rpcError: null,
  connection: null,
  rpcCalls: [],
};

const client = {
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: table === 'projects' ? state.project : state.connection,
          error: null,
        }),
      }),
    }),
  }),
  rpc: async (name: string, args: unknown) => {
    state.rpcCalls.push({ name, args });
    return state.rpcError
      ? { data: null, error: state.rpcError }
      : { data: state.hasAccess, error: null };
  },
};

/** The stand-in above, typed as the real client for direct calls. */
const asClient = client as unknown as Parameters<typeof assertProjectAccess>[0];

beforeEach(() => {
  state.project = null;
  state.hasAccess = false;
  state.rpcError = null;
  state.connection = null;
  state.rpcCalls = [];
});

describe('assertProjectAccess', () => {
  it('refuses a project whose row is readable but whose account is not the caller’s — a public project', async () => {
    state.project = { account_id: 'other-account' };
    state.hasAccess = false;

    await expect(assertProjectAccess(asClient, 'p1')).rejects.toThrow(
      'Project not found or access denied',
    );
    expect(state.rpcCalls).toEqual([
      { name: 'has_account_access', args: { p_account_id: 'other-account' } },
    ]);
  });

  it('allows a member, and returns the project’s account', async () => {
    state.project = { account_id: 'a1' };
    state.hasAccess = true;

    await expect(assertProjectAccess(asClient, 'p1')).resolves.toBe('a1');
  });

  it('refuses a project the caller cannot read at all, with the same message', async () => {
    await expect(assertProjectAccess(asClient, 'p1')).rejects.toThrow(
      'Project not found or access denied',
    );
  });

  it('fails closed when the access check itself fails', async () => {
    state.project = { account_id: 'a1' };
    state.rpcError = { message: 'boom' };

    await expect(assertProjectAccess(asClient, 'p1')).rejects.toThrow(
      'Failed to check account access',
    );
  });
});

describe('assertAccountAccess', () => {
  it('refuses an account the caller has no access to, even one with a public profile', async () => {
    await expect(assertAccountAccess(asClient, 'a2')).rejects.toThrow(
      'Account not found or access denied',
    );
  });

  it('allows an account the caller owns or has a role on', async () => {
    state.hasAccess = true;

    await expect(assertAccountAccess(asClient, 'a1')).resolves.toBe('a1');
  });
});

describe('assertScopeAccess', () => {
  it('goes through the membership check for a project scope', async () => {
    state.project = { account_id: 'other-account' };

    await expect(
      assertScopeAccess(asClient, { projectId: 'p1' }),
    ).rejects.toThrow('Project not found or access denied');
  });

  it('still refuses a channel from another account once access is proven', async () => {
    state.project = { account_id: 'a1' };
    state.hasAccess = true;
    state.connection = { id: 'c1', account_id: 'a2' };

    await expect(
      assertScopeAccess(asClient, { projectId: 'p1', connectionId: 'c1' }),
    ).rejects.toThrow('Channel not found or not part of this scope');
  });

  it('returns the account for a member with a channel of that account', async () => {
    state.project = { account_id: 'a1' };
    state.hasAccess = true;
    state.connection = { id: 'c1', account_id: 'a1' };

    await expect(
      assertScopeAccess(asClient, { projectId: 'p1', connectionId: 'c1' }),
    ).resolves.toBe('a1');
  });
});
