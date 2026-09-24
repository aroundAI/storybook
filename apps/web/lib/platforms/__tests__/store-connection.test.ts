import { beforeEach, describe, expect, it, vi } from 'vitest';

import { storePlatformConnections } from '../store-connection';

/**
 * KB-43. Members may no longer read a connection's token columns, and an
 * upsert reads them back through EXCLUDED, so the OAuth callbacks write
 * through the admin client. The admin client skips RLS, and RLS was the only
 * thing checking the account: `account_id` comes from the `state` parameter,
 * which the browser supplies. So the helper asks has_account_access — the
 * predicate the RLS policies use — on the user's own client first.
 */

const admin = vi.hoisted(() => ({
  upsert: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({ from: admin.from }),
}));

const MINE = '11111111-1111-4111-8111-111111111111';
const THEIRS = '22222222-2222-4222-8222-222222222222';

function row(accountId: string, platformAccountId = 'UC-1') {
  return {
    account_id: accountId,
    platform: 'youtube',
    platform_account_id: platformAccountId,
    platform_account_name: 'Channel',
    access_token_encrypted: 'enc-access',
    refresh_token_encrypted: 'enc-refresh',
    is_active: true,
  };
}

function userClient(access: Record<string, boolean | Error>) {
  const rpc = vi.fn(async (_fn: string, args: { p_account_id: string }) => {
    const answer = access[args.p_account_id] ?? false;

    return answer instanceof Error
      ? { data: null, error: answer }
      : { data: answer, error: null };
  });

  return { rpc } as unknown as Parameters<
    typeof storePlatformConnections
  >[0] & {
    rpc: typeof rpc;
  };
}

beforeEach(() => {
  admin.upsert.mockReset().mockResolvedValue({ error: null });
  admin.from.mockReset().mockReturnValue({ upsert: admin.upsert });
});

describe('storePlatformConnections', () => {
  it('upserts through the admin client when the user can access the account', async () => {
    const client = userClient({ [MINE]: true });
    const rows = [row(MINE)];

    const result = await storePlatformConnections(client, rows);

    expect(result).toEqual({ error: null });
    expect(client.rpc).toHaveBeenCalledWith('has_account_access', {
      p_account_id: MINE,
    });
    expect(admin.from).toHaveBeenCalledWith('platform_connections');
    expect(admin.upsert).toHaveBeenCalledWith(rows, {
      onConflict: 'account_id,platform,platform_account_id',
    });
  });

  it('writes nothing for an account the user cannot access', async () => {
    const client = userClient({ [MINE]: true, [THEIRS]: false });

    const result = await storePlatformConnections(client, [row(THEIRS)]);

    expect(result.error?.branch).toBe('connection_access_check');
    expect(admin.upsert).not.toHaveBeenCalled();
  });

  it('writes nothing when one row of a batch names another account', async () => {
    const client = userClient({ [MINE]: true, [THEIRS]: false });

    const result = await storePlatformConnections(client, [
      row(MINE, 'page-1'),
      row(THEIRS, 'page-2'),
    ]);

    expect(result.error?.branch).toBe('connection_access_check');
    expect(admin.upsert).not.toHaveBeenCalled();
  });

  it('treats a failed access check as a refusal', async () => {
    const failure = new Error('rpc down');
    const client = userClient({ [MINE]: failure });

    const result = await storePlatformConnections(client, [row(MINE)]);

    expect(result.error).toEqual({
      branch: 'connection_access_check',
      cause: failure,
    });
    expect(admin.upsert).not.toHaveBeenCalled();
  });

  it('checks each account once for a batch on one account', async () => {
    const client = userClient({ [MINE]: true });

    await storePlatformConnections(client, [
      row(MINE, 'page-1'),
      row(MINE, 'ig-1'),
    ]);

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(admin.upsert).toHaveBeenCalledTimes(1);
  });

  it('reports an upsert failure under the branch the callbacks already log', async () => {
    const failure = { message: 'duplicate key', code: '23505' };
    admin.upsert.mockResolvedValue({ error: failure });

    const result = await storePlatformConnections(
      userClient({ [MINE]: true }),
      [row(MINE)],
    );

    expect(result.error).toEqual({
      branch: 'connection_upsert',
      cause: failure,
    });
  });
});
