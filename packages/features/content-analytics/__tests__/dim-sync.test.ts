import { describe, expect, it, vi } from 'vitest';

import { buildVideoDims } from '../src/server/dim-sync';
import type { PublishDimRow } from '../src/server/dim-sync';

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: vi.fn(),
}));

/** `publish_tags` answers empty; tags are not this file's subject. */
const client = {
  from: () => {
    const chain = {
      select: () => chain,
      in: () => chain,
      order: () => chain,
      range: () => Promise.resolve({ data: [], error: null }),
    };

    return chain;
  },
} as unknown as Parameters<typeof buildVideoDims>[0];

/**
 * A Short cut from a 22-minute episode — the row FILM-1710 is about. Its
 * episode says 1,320 seconds and the render that produced it was planned at
 * 1,500; neither is the clip's length.
 */
function short(overrides: Partial<PublishDimRow> = {}): PublishDimRow {
  return {
    id: 'p1',
    episode_id: 'e1',
    platform: 'youtube',
    platform_connection_id: 'c1',
    content_type: 'short',
    language: 'en',
    // Not this file's subject (FILM-1702 added the field); null is the
    // manual-upload case, same as the interface's own default reading.
    platform_connections: null,
    title: 'A Short',
    published_at: '2026-09-01T00:00:00Z',
    duration_seconds: 45,
    episodes: {
      project_id: 'proj-1',
      duration_seconds: 1320,
      projects: { account_id: 'acct-1' },
    },
    ...overrides,
  };
}

describe('buildVideoDims — the two durations', () => {
  it('reports a 45-second Short as 45 seconds, not as its episode', async () => {
    const [dim] = await buildVideoDims(client, [short()]);

    expect(dim).toMatchObject({
      asset_duration_seconds: 45,
      episode_duration_seconds: 1320,
    });
  });

  it('leaves an unmeasured asset null — never the episode, never zero', async () => {
    const [dim] = await buildVideoDims(client, [
      short({ duration_seconds: null }),
    ]);

    expect(dim!.asset_duration_seconds).toBeNull();
    expect(dim!.episode_duration_seconds).toBe(1320);
  });

  it('does not fall back to a target duration for either column', async () => {
    // The old mapping read `episodes.target_duration_seconds` when the
    // render had reported nothing. A row that still carries one — as any
    // stale select would — must not leak it into a measurement.
    const row = short({ duration_seconds: null });

    row.episodes = {
      project_id: 'proj-1',
      duration_seconds: null,
      projects: { account_id: 'acct-1' },
      ...{ target_duration_seconds: 1500 },
    };

    const [dim] = await buildVideoDims(client, [row]);

    expect(dim!.asset_duration_seconds).toBeNull();
    expect(dim!.episode_duration_seconds).toBe(0);
  });

  it('no longer writes a column named duration_seconds', async () => {
    const [dim] = await buildVideoDims(client, [short()]);

    expect(dim).not.toHaveProperty('duration_seconds');
  });
});
