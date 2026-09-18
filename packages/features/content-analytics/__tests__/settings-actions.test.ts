import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  updateAccountAnalyticsSettingsAction,
  updateChannelAnalyticsSettingsAction,
} from '../src/server/settings-actions';

type ReadResult = {
  data: { id: string } | null;
  error: { message: string } | null;
};

const state: {
  accountRead: ReadResult;
  connectionRead: {
    data: { id: string; account_id: string } | null;
    error: { message: string } | null;
  };
  storedChannelRead: {
    data: { joined_ypp_at: string | null } | null;
    error: { message: string } | null;
  };
  upsertError: { message: string } | null;
} = {
  accountRead: { data: null, error: null },
  connectionRead: {
    data: { id: 'c1', account_id: 'a1' },
    error: null,
  },
  storedChannelRead: { data: null, error: null },
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

      const read =
        table === 'platform_connections'
          ? () => state.connectionRead
          : table === 'channel_analytics_settings'
            ? () => state.storedChannelRead
            : () => state.accountRead;

      const query = {
        select: () => query,
        eq: () => query,
        upsert,
        maybeSingle: async () => read(),
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

function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const channelInput = {
  connectionId: '00000000-0000-4000-8000-0000000000c1',
  yppTargetWatchHours: 7000,
  yppTargetSubscribers: null,
  yppApplicantStatus: 'unknown' as const,
  joinedYppAt: null as string | null,
};

describe('updateChannelAnalyticsSettingsAction joined date', () => {
  const future = isoDaysFromNow(7);

  beforeEach(() => {
    upsert.mockClear();
    state.upsertError = null;
    state.connectionRead = {
      data: { id: 'c1', account_id: 'a1' },
      error: null,
    };
    state.storedChannelRead = { data: null, error: null };
  });

  // Rows written before the bound existed hold a future date. Refusing them
  // would lock the targets and the applicant status on that channel's card.
  it('saves when the future date is the one already stored', async () => {
    state.storedChannelRead = { data: { joined_ypp_at: future }, error: null };

    await expect(
      updateChannelAnalyticsSettingsAction({
        ...channelInput,
        joinedYppAt: future,
      }),
    ).resolves.toEqual({ ok: true });

    expect(upsert).toHaveBeenCalledOnce();
  });

  it('refuses a future date that is not the stored one', async () => {
    state.storedChannelRead = { data: { joined_ypp_at: null }, error: null };

    await expect(
      updateChannelAnalyticsSettingsAction({
        ...channelInput,
        joinedYppAt: future,
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_joined_date' });

    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not read the row at all for a date in the past', async () => {
    await expect(
      updateChannelAnalyticsSettingsAction({
        ...channelInput,
        joinedYppAt: '2025-01-15',
      }),
    ).resolves.toEqual({ ok: true });
  });
});
