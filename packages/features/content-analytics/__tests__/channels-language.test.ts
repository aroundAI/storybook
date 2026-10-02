import { afterEach, describe, expect, it, vi } from 'vitest';

import { listAccountChannels } from '../src/server/channels';

// Off, as shipped (owner, 2026-10-02); a test switches it on.
const xSwitch = vi.hoisted(() => ({ on: false }));

vi.mock('@kit/publishing/lib/x-switch', () => ({
  get X_ENABLED() {
    return xSwitch.on;
  },
}));

afterEach(() => {
  xSwitch.on = false;
});

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({}),
}));

vi.mock('@kit/shared/pagination', () => ({
  fetchAllRows: async (
    page: (
      from: number,
      to: number,
    ) => Promise<{ data: unknown[] | null; error: unknown }>,
  ) => (await page(0, 999)).data ?? [],
  fetchAllByIds: vi.fn(),
}));

/**
 * FILM-1704 §3: the connected half of coverage names each channel's target
 * language — FILM-1702's channel dimension, and what the coverage strip
 * says beside a channel. `listAccountChannels` has to select it to carry it.
 */
describe('listAccountChannels', () => {
  it("reads each channel's target language", async () => {
    const selected: string[] = [];
    const rows = [
      {
        id: '00000000-0000-4000-8000-0000000000c1',
        platform: 'youtube',
        platform_account_name: 'Canal',
        is_active: true,
        metadata: null,
        language: 'es',
      },
    ];

    const builder = {
      select(columns: string) {
        selected.push(columns);
        return builder;
      },
      eq: () => builder,
      order: () => builder,
      range: async () => ({ data: rows, error: null }),
    };

    const client = { from: () => builder };

    const channels = await listAccountChannels(
      '00000000-0000-4000-8000-0000000000b1',
      client as never,
    );

    expect(selected[0]).toMatch(/\blanguage\b/);
    expect(channels).toEqual([
      expect.objectContaining({ platform: 'youtube', language: 'es' }),
    ]);
  });

  // FILM-717: LinkedIn is removed and its rows are kept; such a row is not a
  // channel, so no surface lists it or names it unsupported.
  it('leaves out a kept row on a removed platform', async () => {
    const row = (id: string, platform: string) => ({
      id,
      platform,
      platform_account_name: platform,
      is_active: true,
      metadata: null,
      language: 'en',
    });
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: async () => ({
        data: [row('c-li', 'linkedin'), row('c-yt', 'youtube')],
        error: null,
      }),
    };

    const channels = await listAccountChannels(
      '00000000-0000-4000-8000-0000000000b1',
      { from: () => builder } as never,
    );

    expect(channels.map((channel) => channel.connectionId)).toEqual(['c-yt']);
  });

  // X is hidden while `X_ENABLED` is off: its kept channel is not listed,
  // so the strip, the switcher and the coverage counts never meet it.
  async function channelsWithX() {
    const row = (id: string, platform: string) => ({
      id,
      platform,
      platform_account_name: platform,
      is_active: true,
      metadata: null,
      language: 'en',
    });
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: async () => ({
        data: [row('c-x', 'twitter'), row('c-yt', 'youtube')],
        error: null,
      }),
    };

    const channels = await listAccountChannels(
      '00000000-0000-4000-8000-0000000000b1',
      { from: () => builder } as never,
    );

    return channels.map((channel) => channel.connectionId).sort();
  }

  it('leaves out a kept X channel while X is hidden', async () => {
    expect(await channelsWithX()).toEqual(['c-yt']);
  });

  it('lists the X channel again once X is switched on', async () => {
    xSwitch.on = true;

    expect(await channelsWithX()).toEqual(['c-x', 'c-yt']);
  });
});
