import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CAPABILITY_MATRIX } from '@kit/clickhouse';

import { CoverageMatrixSchema } from '../src/lib/schemas/coverage.schema';
import { getCoverageMatrixAction } from '../src/server/coverage-actions';

/**
 * FILM-1704 §4: the one action the analytics page asks for coverage. It
 * joins the connected half (Postgres) to the observed half (ClickHouse) and
 * folds them, so a card reads a state rather than working one out.
 */

const mocks = vi.hoisted(() => ({
  assertScopeAccess: vi.fn(),
  listAccountChannels: vi.fn(),
  queryObservedCoverage: vi.fn(),
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction: (handler: (data: unknown) => unknown) => handler,
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({}),
}));

vi.mock('@kit/clickhouse/server', () => ({
  queryObservedCoverage: mocks.queryObservedCoverage,
}));

vi.mock('../src/server/scope-access', () => ({
  assertScopeAccess: mocks.assertScopeAccess,
}));

vi.mock('../src/server/channels', () => ({
  listAccountChannels: mocks.listAccountChannels,
}));

const projectId = '00000000-0000-4000-8000-0000000000a1';
const accountId = '00000000-0000-4000-8000-0000000000b1';
const youtubeId = '00000000-0000-4000-8000-0000000000c1';
const tiktokId = '00000000-0000-4000-8000-0000000000c2';

const channel = (
  connectionId: string,
  platform: string,
  overrides: Record<string, unknown> = {},
) => ({
  connectionId,
  platform,
  name: platform,
  thumbnailUrl: null,
  isActive: true,
  language: 'en',
  ...overrides,
});

const window = { from: '2026-09-01', to: '2026-09-30' };

describe('getCoverageMatrixAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertScopeAccess.mockResolvedValue(accountId);
    mocks.listAccountChannels.mockResolvedValue([
      channel(youtubeId, 'youtube'),
      channel(tiktokId, 'tiktok', { language: 'es' }),
    ]);
    mocks.queryObservedCoverage.mockResolvedValue([
      {
        table: 'video_traffic_sources',
        platform: 'youtube',
        rows: 12,
        latestDate: '2026-09-29',
        metricSources: [],
      },
    ]);
  });

  it('checks access before reading anything', async () => {
    mocks.assertScopeAccess.mockRejectedValue(
      new Error('Project not found or access denied'),
    );

    await expect(
      getCoverageMatrixAction({ scope: { projectId }, ...window }),
    ).rejects.toThrow('Project not found or access denied');

    expect(mocks.listAccountChannels).not.toHaveBeenCalled();
    expect(mocks.queryObservedCoverage).not.toHaveBeenCalled();
  });

  it('asks ClickHouse once, for the scope and the window it was given', async () => {
    await getCoverageMatrixAction({ scope: { projectId }, ...window });

    expect(mocks.queryObservedCoverage).toHaveBeenCalledOnce();
    expect(mocks.queryObservedCoverage).toHaveBeenCalledWith(
      { projectId },
      '2026-09-01',
      '2026-09-30',
    );
  });

  it("reads the connected half from the scope's account", async () => {
    await getCoverageMatrixAction({ scope: { projectId }, ...window });

    expect(mocks.listAccountChannels).toHaveBeenCalledWith(
      accountId,
      expect.anything(),
    );
  });

  it('keeps not connected, no data in window and unsupported apart', async () => {
    const result = await getCoverageMatrixAction({
      scope: { projectId },
      ...window,
    });

    expect(result.observed).toBe(true);
    expect(result.window).toEqual(window);
    expect(result.matrix.traffic_sources.youtube).toMatchObject({
      kind: 'covered',
      rows: 12,
    });
    expect(result.matrix.engagement.tiktok).toEqual({
      kind: 'no_data_in_window',
    });
    expect(result.matrix.engagement.instagram).toEqual({
      kind: 'not_connected',
    });
    expect(result.matrix.traffic_sources.instagram).toEqual({
      kind: 'unsupported',
      note: CAPABILITY_MATRIX.traffic_sources.instagram.note,
    });
  });

  it('names each channel with its target language, for the strip', async () => {
    const result = await getCoverageMatrixAction({
      scope: { projectId },
      ...window,
    });

    expect(
      result.channels.map(({ platform, language }) => [platform, language]),
    ).toEqual([
      ['youtube', 'en'],
      ['tiktok', 'es'],
    ]);
  });

  it('a project with no connections is answered without ClickHouse, and reads as not connected', async () => {
    mocks.listAccountChannels.mockResolvedValue([]);

    const result = await getCoverageMatrixAction({
      scope: { projectId },
      ...window,
    });

    expect(mocks.queryObservedCoverage).not.toHaveBeenCalled();
    expect(result.observed).toBe(true);
    expect(result.matrix.engagement.youtube).toEqual({ kind: 'not_connected' });
    expect(result.matrix.traffic_sources.tiktok).toMatchObject({
      kind: 'not_ingested',
    });
  });

  it('an inactive connection is not connected', async () => {
    mocks.listAccountChannels.mockResolvedValue([
      channel(youtubeId, 'youtube'),
      channel(tiktokId, 'tiktok', { isActive: false }),
    ]);

    const result = await getCoverageMatrixAction({
      scope: { projectId },
      ...window,
    });

    expect(result.matrix.engagement.tiktok).toEqual({ kind: 'not_connected' });
  });

  it('a channel filter narrows "connected" to that channel', async () => {
    const result = await getCoverageMatrixAction({
      scope: { projectId, connectionId: youtubeId },
      ...window,
    });

    expect(result.matrix.engagement.tiktok).toEqual({ kind: 'not_connected' });
    expect(result.channels.map((c) => c.connectionId)).toEqual([youtubeId]);
  });

  it('when ClickHouse is off, the observed half is "cannot measure", never "no data"', async () => {
    mocks.queryObservedCoverage.mockResolvedValue(null);

    const result = await getCoverageMatrixAction({
      scope: { projectId },
      ...window,
    });

    expect(result.observed).toBe(false);
    expect(result.matrix.engagement.youtube).toBeNull();
    expect(result.matrix.engagement.instagram).toEqual({
      kind: 'not_connected',
    });
  });
});

describe('CoverageMatrixSchema', () => {
  it('takes calendar days, not timestamps', () => {
    expect(
      CoverageMatrixSchema.safeParse({ scope: { projectId }, ...window })
        .success,
    ).toBe(true);
    expect(
      CoverageMatrixSchema.safeParse({
        scope: { projectId },
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-30',
      }).success,
    ).toBe(false);
  });

  it('refuses a window that ends before it starts', () => {
    expect(
      CoverageMatrixSchema.safeParse({
        scope: { projectId },
        from: '2026-09-30',
        to: '2026-09-01',
      }).success,
    ).toBe(false);
  });

  it('refuses an unscoped request', () => {
    expect(
      CoverageMatrixSchema.safeParse({ scope: {}, ...window }).success,
    ).toBe(false);
  });
});
