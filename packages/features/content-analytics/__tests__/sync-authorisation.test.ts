import { describe, expect, it } from 'vitest';

import {
  mayFetchRevenue,
  syncEligibility,
  toConnectionGrant,
} from '../src/server/sync-authorisation';

const MAX = 5;

const TIKTOK_PUBLISH_ONLY = ['user.info.basic', 'video.upload'];
const TIKTOK_WITH_ANALYTICS = [...TIKTOK_PUBLISH_ONLY, 'video.list'];

function grant(
  scopes: string[] | null,
  grantedAt: string | null = null,
  disconnectedAt: string | null = null,
) {
  return { scopes, grantedAt, accountGated: [], disconnectedAt };
}

describe('syncEligibility', () => {
  it('does not try a connection whose recorded grant lacks the analytics scope', () => {
    expect(
      syncEligibility({
        platform: 'tiktok',
        sync: undefined,
        grant: grant(TIKTOK_PUBLISH_ONLY),
        maxConsecutiveFailures: MAX,
      }),
    ).toBe('not_authorised');
  });

  it('tries it once the scope is held', () => {
    expect(
      syncEligibility({
        platform: 'tiktok',
        sync: undefined,
        grant: grant(TIKTOK_WITH_ANALYTICS),
        maxConsecutiveFailures: MAX,
      }),
    ).toBe('eligible');
  });

  it('still tries a connection with no recorded grant, which predates the record', () => {
    for (const scopes of [null, []]) {
      expect(
        syncEligibility({
          platform: 'youtube',
          sync: undefined,
          grant: grant(scopes),
          maxConsecutiveFailures: MAX,
        }),
      ).toBe('eligible');
    }
  });

  it('leaves a publish with no connection row to the token check', () => {
    expect(
      syncEligibility({
        platform: 'instagram',
        sync: undefined,
        grant: undefined,
        maxConsecutiveFailures: MAX,
      }),
    ).toBe('eligible');
  });

  it('does not count Instagram as authorised on the publishing pair alone', () => {
    expect(
      syncEligibility({
        platform: 'instagram',
        sync: undefined,
        grant: grant(['instagram_basic', 'instagram_content_publish']),
        maxConsecutiveFailures: MAX,
      }),
    ).toBe('not_authorised');
  });

  describe('a publish the schedule gave up on', () => {
    const failedAt = '2026-09-01T10:00:00.000Z';

    it.each([
      ['requires_reauth', { requires_reauth: true, last_failed_at: failedAt }],
      ['five failures', { consecutive_failures: 5, last_failed_at: failedAt }],
    ])('stays suppressed while nothing has changed (%s)', (_name, sync) => {
      expect(
        syncEligibility({
          platform: 'tiktok',
          sync,
          grant: grant(TIKTOK_WITH_ANALYTICS, '2026-08-01T00:00:00.000Z'),
          maxConsecutiveFailures: MAX,
        }),
      ).toBe('suppressed');
    });

    it('comes back when the creator reconnects after the failure', () => {
      expect(
        syncEligibility({
          platform: 'tiktok',
          sync: { requires_reauth: true, last_failed_at: failedAt },
          grant: grant(TIKTOK_WITH_ANALYTICS, '2026-09-02T00:00:00.000Z'),
          maxConsecutiveFailures: MAX,
        }),
      ).toBe('eligible');
    });

    it('comes back for a failure recorded before failures were dated', () => {
      expect(
        syncEligibility({
          platform: 'tiktok',
          sync: { requires_reauth: true, consecutive_failures: 9 },
          grant: grant(TIKTOK_WITH_ANALYTICS, '2026-09-02T00:00:00.000Z'),
          maxConsecutiveFailures: MAX,
        }),
      ).toBe('eligible');
    });

    it('is suppressed again when it fails after the reconnect', () => {
      expect(
        syncEligibility({
          platform: 'tiktok',
          sync: {
            requires_reauth: true,
            last_failed_at: '2026-09-03T00:00:00.000Z',
          },
          grant: grant(TIKTOK_WITH_ANALYTICS, '2026-09-02T00:00:00.000Z'),
          maxConsecutiveFailures: MAX,
        }),
      ).toBe('suppressed');
    });

    it('is not revived by a connection that was never re-authorised', () => {
      expect(
        syncEligibility({
          platform: 'tiktok',
          sync: { requires_reauth: true },
          grant: grant(TIKTOK_WITH_ANALYTICS, null),
          maxConsecutiveFailures: MAX,
        }),
      ).toBe('suppressed');
    });
  });
});

describe('mayFetchRevenue', () => {
  const ANALYTICS = 'https://www.googleapis.com/auth/yt-analytics.readonly';
  const MONETARY =
    'https://www.googleapis.com/auth/yt-analytics-monetary.readonly';

  it('is false for a connection made before the monetary scope was requested', () => {
    expect(mayFetchRevenue(grant([ANALYTICS]))).toBe(false);
  });

  it('is true once the monetary scope was granted', () => {
    expect(mayFetchRevenue(grant([ANALYTICS, MONETARY]))).toBe(true);
  });

  it('is false with no recorded grant: an unrecorded scope is not a held one', () => {
    expect(mayFetchRevenue(grant(null))).toBe(false);
    expect(mayFetchRevenue(undefined)).toBe(false);
  });
});

describe('toConnectionGrant', () => {
  it('reads the grant time and the account gates out of metadata', () => {
    expect(
      toConnectionGrant({
        scopes: ['a'],
        metadata: {
          scopes_granted_at: '2026-09-22T00:00:00.000Z',
          analytics_account_gated: ['youtube.revenue', 7],
        },
      }),
    ).toEqual({
      scopes: ['a'],
      grantedAt: '2026-09-22T00:00:00.000Z',
      accountGated: ['youtube.revenue'],
      disconnectedAt: null,
    });
  });

  it('survives a row with nothing recorded', () => {
    expect(toConnectionGrant({ scopes: null, metadata: null })).toEqual({
      scopes: null,
      grantedAt: null,
      accountGated: [],
      disconnectedAt: null,
    });
  });

  it('carries the disconnect time (KB-22)', () => {
    expect(
      toConnectionGrant({
        scopes: null,
        metadata: null,
        disconnected_at: '2026-09-23T00:00:00.000Z',
      }).disconnectedAt,
    ).toBe('2026-09-23T00:00:00.000Z');
  });
});

describe('syncEligibility — a disconnected channel (KB-22)', () => {
  const YOUTUBE_FULL = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ];

  it('is not tried: it holds no token, so the call cannot succeed', () => {
    expect(
      syncEligibility({
        platform: 'youtube',
        sync: undefined,
        grant: grant(YOUTUBE_FULL, null, '2026-09-23T00:00:00.000Z'),
        maxConsecutiveFailures: MAX,
      }),
    ).toBe('disconnected');
  });

  it('wins over a scope verdict, so it is not counted as not authorised', () => {
    expect(
      syncEligibility({
        platform: 'tiktok',
        sync: undefined,
        grant: grant(TIKTOK_PUBLISH_ONLY, null, '2026-09-23T00:00:00.000Z'),
        maxConsecutiveFailures: MAX,
      }),
    ).toBe('disconnected');
  });

  it('is eligible again once reconnected, whatever failed while it was away', () => {
    expect(
      syncEligibility({
        platform: 'youtube',
        sync: {
          requires_reauth: true,
          consecutive_failures: MAX,
          last_failed_at: '2026-09-23T01:00:00.000Z',
        },
        grant: grant(YOUTUBE_FULL, '2026-09-24T00:00:00.000Z', null),
        maxConsecutiveFailures: MAX,
      }),
    ).toBe('eligible');
  });
});
