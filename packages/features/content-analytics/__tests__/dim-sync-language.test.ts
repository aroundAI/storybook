import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VideoDim } from '@kit/clickhouse/server';

import { upsertVideoDims } from '../src/server/dim-sync';

/**
 * What dim-sync writes for a publish's two languages (FILM-1702).
 *
 * `language: row.language ?? 'en'` is the line that made English the bucket
 * for every publish nobody had labelled: it is the only place a Postgres
 * NULL becomes a ClickHouse value, so whatever it writes is what every
 * breakdown downstream groups by.
 */
const state: { publishes: unknown[]; written: VideoDim[]; select: string } = {
  publishes: [],
  written: [],
  select: '',
};

function publish(
  id: string,
  language: string | null,
  channel: { language: string | null } | null,
) {
  return {
    id,
    episode_id: `episode-${id}`,
    platform: 'youtube',
    platform_connection_id: channel ? `connection-${id}` : null,
    content_type: 'full',
    language,
    platform_connections: channel,
    title: id,
    published_at: '2026-09-01T00:00:00Z',
    episodes: {
      project_id: 'project-1',
      duration_seconds: 60,
      target_duration_seconds: null,
      projects: { account_id: 'account-1' },
    },
  };
}

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    from: (table: string) => {
      const rows = table === 'publishes' ? state.publishes : [];
      const chain = {
        select: (columns: string) => {
          if (table === 'publishes') state.select = columns;
          return chain;
        },
        eq: () => chain,
        not: () => chain,
        in: () => chain,
        order: () => chain,
        range: async (from: number) => ({
          data: from === 0 ? rows : [],
          error: null,
        }),
      };

      return chain;
    },
  }),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

vi.mock('@kit/clickhouse/server', async () => {
  const pure =
    await vi.importActual<typeof import('@kit/clickhouse')>('@kit/clickhouse');

  return {
    toDimLanguage: pure.toDimLanguage,
    insertVideoDims: async (rows: VideoDim[]) => {
      state.written.push(...rows);
    },
  };
});

const written = (id: string) =>
  state.written.find((row) => row.video_id === id);

beforeEach(() => {
  state.written = [];
  state.select = '';
  state.publishes = [
    publish('explicit', 'es', { language: 'es' }),
    publish('unset', null, { language: 'en' }),
    publish('misrouted', 'es', { language: 'en' }),
    publish('external', null, null),
    publish('english', 'en', { language: 'en' }),
  ];
});

describe('upsertVideoDims — languages', () => {
  it('writes a language nobody set as not-set, never as English', async () => {
    await upsertVideoDims();

    expect(written('unset')?.language).toBe('');
    expect(written('external')?.language).toBe('');
  });

  it('keeps a deliberate English publish English', async () => {
    await upsertVideoDims();

    expect(written('english')?.language).toBe('en');
  });

  it("writes the channel's target beside the publish's own language", async () => {
    await upsertVideoDims();

    expect(written('misrouted')).toMatchObject({
      language: 'es',
      channel_language: 'en',
    });
    expect(written('unset')?.channel_language).toBe('en');
    expect(written('explicit')?.channel_language).toBe('es');
  });

  it('writes no channel target for a publish with no channel', async () => {
    await upsertVideoDims();

    expect(written('external')?.channel_language).toBe('');
  });

  it("reads the channel's language with the publish", async () => {
    await upsertVideoDims();

    expect(state.select).toContain('platform_connections(language)');
  });
});
