import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MetricFamily } from '@kit/clickhouse';

/**
 * X is retired for now by the owner, 2026-10-02: hidden behind `X_ENABLED`,
 * its code kept. While it is off the analytics page neither offers X in its
 * platform filter nor counts it in any "N of M platforms"; switched on, it
 * does both again. Each case loads the modules fresh with the switch set.
 */

async function load(xEnabled?: boolean) {
  vi.resetModules();

  if (xEnabled !== undefined) {
    vi.doMock('@kit/publishing/lib/x-switch', () => ({ X_ENABLED: xEnabled }));
  }

  return {
    ...(await import('../src/lib/shown-platforms')),
    ...(await import('../src/lib/platform-selection')),
    ...(await import('../src/lib/provenance')),
    ...(await import('../src/lib/schemas/platforms.schema')),
  };
}

afterEach(() => {
  vi.doUnmock('@kit/publishing/lib/x-switch');
});

/** A page whose coverage has not arrived: the chip paints from capability. */
const pending = {
  windowLabel: 'the last 30 days',
  cellsFor: () => {
    throw new Error('not read before coverage arrives');
  },
  channels: undefined,
  observed: undefined,
};

const ENGAGEMENT: MetricFamily[] = ['engagement'];

function pendingChipLabel(
  provenanceChip: Awaited<ReturnType<typeof load>>['provenanceChip'],
  platforms: readonly string[],
) {
  return provenanceChip(
    {
      ...pending,
      cellsFor: () =>
        Object.fromEntries(
          platforms.map((platform) => [platform, 'pending']),
        ) as never,
    },
    ENGAGEMENT,
  ).label;
}

describe('the analytics page, with X as shipped', () => {
  it('offers four platforms in the filter, not X', async () => {
    const { SHOWN_ANALYTICS_PLATFORMS } = await load();

    expect(SHOWN_ANALYTICS_PLATFORMS).toEqual([
      'youtube',
      'tiktok',
      'instagram',
      'facebook',
    ]);
  });

  it('reads the four as every platform', async () => {
    const { selectsEveryPlatform } = await load();

    expect(
      selectsEveryPlatform(['youtube', 'tiktok', 'instagram', 'facebook']),
    ).toBe(true);
  });

  it('counts out of four', async () => {
    const { provenanceChip, SHOWN_ANALYTICS_PLATFORMS } = await load();

    expect(pendingChipLabel(provenanceChip, SHOWN_ANALYTICS_PLATFORMS)).toBe(
      'Up to 4 platforms · partly derived',
    );
  });

  it('refuses a request that selects X', async () => {
    const { PlatformSelectionSchema } = await load();

    expect(PlatformSelectionSchema.safeParse(['twitter']).success).toBe(false);
    expect(
      PlatformSelectionSchema.safeParse(['youtube', 'twitter']).success,
    ).toBe(false);
    expect(PlatformSelectionSchema.safeParse(['youtube']).success).toBe(true);
  });
});

describe('the analytics page, with X switched on', () => {
  it('offers X in the filter again', async () => {
    const { SHOWN_ANALYTICS_PLATFORMS } = await load(true);

    expect(SHOWN_ANALYTICS_PLATFORMS).toEqual([
      'youtube',
      'tiktok',
      'instagram',
      'facebook',
      'twitter',
    ]);
  });

  it('counts X again', async () => {
    const { provenanceChip, SHOWN_ANALYTICS_PLATFORMS, selectsEveryPlatform } =
      await load(true);

    expect(pendingChipLabel(provenanceChip, SHOWN_ANALYTICS_PLATFORMS)).toBe(
      'Up to 5 platforms · partly derived',
    );
    expect(
      selectsEveryPlatform(['youtube', 'tiktok', 'instagram', 'facebook']),
    ).toBe(false);
  });

  it('accepts a request that selects X', async () => {
    const { PlatformSelectionSchema } = await load(true);

    expect(PlatformSelectionSchema.safeParse(['twitter']).success).toBe(true);
  });
});
