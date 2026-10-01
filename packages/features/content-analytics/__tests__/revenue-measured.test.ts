import { describe, expect, it, vi } from 'vitest';

import { normalizeAnalytics } from '../src/server/analytics-sync-cron';

/**
 * FILM-1726. Only a YouTube read authorised for revenue measured it. A
 * TikTok or Instagram zero is hardcoded because neither reports earnings, so
 * it must never reach `revenue_records` as a synced figure.
 */

vi.mock('@kit/clickhouse/server', () => ({
  formatDateStr: () => '2026-10-01',
}));
vi.mock('@kit/supabase/server-admin-client', () => ({}));
vi.mock('@kit/shared/logger', () => ({ getLogger: async () => ({}) }));
vi.mock('../src/providers/instagram', () => ({
  InstagramInsightsScopeError: class extends Error {},
}));
vi.mock('../src/providers/tiktok', () => ({
  TikTokAnalyticsScopeError: class extends Error {},
  TikTokRateLimitError: class extends Error {},
}));
vi.mock('../src/providers/youtube', () => ({
  YouTubeAnalyticsScopeError: class extends Error {},
}));

const totals = { views: 10, likes: 1, comments: 1, shares: 1 };

function youtube(revenueAccess: string) {
  return {
    totals: {
      ...totals,
      estimatedRevenue: 0,
      estimatedAdRevenue: 0,
      estimatedRedPartnerRevenue: 0,
    },
    revenueAccess,
    dailyRevenue: [],
  };
}

describe('revenue_measured', () => {
  it('is false for TikTok and Instagram, which report no earnings', () => {
    for (const platform of ['tiktok', 'instagram'] as const) {
      const normalized = normalizeAnalytics('pub', '2026-10-01', platform, {
        totals: { ...totals, watchTimeMs: null },
      });

      expect(normalized.revenue_measured, platform).toBe(false);
    }
  });

  it('is true for YouTube only when the read was authorised', () => {
    expect(
      normalizeAnalytics('pub', '2026-10-01', 'youtube', youtube('authorised'))
        .revenue_measured,
    ).toBe(true);

    for (const access of [
      'scope_missing',
      'account_type_gated',
      'unavailable',
    ]) {
      expect(
        normalizeAnalytics('pub', '2026-10-01', 'youtube', youtube(access))
          .revenue_measured,
        access,
      ).toBe(false);
    }
  });
});
