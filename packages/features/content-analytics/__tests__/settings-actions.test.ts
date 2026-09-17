import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateAccountAnalyticsSettingsAction } from '../src/server/settings-actions';

type ReadResult = {
  data: { id: string } | null;
  error: { message: string } | null;
};

const state: {
  accountRead: ReadResult;
  upsertError: { message: string } | null;
} = {
  accountRead: { data: null, error: null },
  upsertError: null,
};

const upsert = vi.fn(async () => ({ error: state.upsertError }));

vi.mock('@kit/next/actions', () => ({
  enhanceAction: (handler: (data: unknown) => unknown) => handler,
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: (table: string) => {
      if (table === 'analytics_settings') return { upsert };

      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => state.accountRead,
      };

      return query;
    },
  }),
}));

const input = {
  accountId: '00000000-0000-4000-8000-000000000001',
  yppTargetWatchHours: 4000,
  yppTargetSubscribers: null,
  tagMinSample: null,
};

describe('updateAccountAnalyticsSettingsAction', () => {
  beforeEach(() => {
    upsert.mockClear();
    state.upsertError = null;
  });

  // A member whose read failed is not a member without access. Reporting the
  // outage as `no_access` tells a real member they have been locked out.
  it('reports a failed account read as write_failed, not no_access', async () => {
    state.accountRead = { data: null, error: { message: 'connection reset' } };

    await expect(updateAccountAnalyticsSettingsAction(input)).resolves.toEqual({
      ok: false,
      reason: 'write_failed',
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reports an account the caller cannot see as no_access', async () => {
    state.accountRead = { data: null, error: null };

    await expect(updateAccountAnalyticsSettingsAction(input)).resolves.toEqual({
      ok: false,
      reason: 'no_access',
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('writes the settings when the account is visible', async () => {
    state.accountRead = { data: { id: input.accountId }, error: null };

    await expect(updateAccountAnalyticsSettingsAction(input)).resolves.toEqual({
      ok: true,
    });
    expect(upsert).toHaveBeenCalledOnce();
  });
});
