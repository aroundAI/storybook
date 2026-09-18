import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getVideoLogAction } from '../src/server/video-log-actions';

/**
 * The Video Log carries each video's analytics note from Postgres
 * (FILM-1610 review, D3). Notes are never synced to ClickHouse, so this join
 * is the only way a note reaches the log — and it had no test.
 */

const state: {
  notes: Array<{
    id: string;
    analytics_note: string | null;
  }>;
  notesError: { message: string } | null;
  /** What `editable_publish_ids` returns for the caller. */
  editableIds: string[];
  rpcCalls: string[];
} = { notes: [], notesError: null, editableIds: [], rpcCalls: [] };

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (handler: (data: unknown, user: unknown) => unknown) => (data: unknown) =>
      handler(data, { id: 'u1' }),
}));

vi.mock('../src/server/scope-access', () => ({
  assertScopeAccess: async () => undefined,
}));

vi.mock('../src/server/channels', () => ({
  listProjectChannels: async () => [],
  listAccountChannels: async () => [],
}));

function ageRow(videoId: string) {
  return {
    videoId,
    title: videoId,
    publishedAt: '2026-01-01',
    connectionId: 'c1',
    platform: 'youtube',
    contentType: 'full',
    language: 'en',
    viewsAtAge: { 30: 10 },
    matureAt: { 30: true },
    lifetimeViews: 10,
    ingestLagDays: 0,
  };
}

vi.mock('@kit/clickhouse/server', () => ({
  checkpointPredatesIngest: () => false,
  queryVideoViewsAtAge: async () => [ageRow('p1'), ageRow('p2')],
  queryQualityMetricsForVideos: async () => new Map(),
}));

/** A PostgREST-shaped builder whose terminal `range` resolves the page. */
function pageOf(rows: unknown[], error: { message: string } | null = null) {
  const builder = {
    select: () => builder,
    in: () => builder,
    not: () => builder,
    order: () => builder,
    // One page: rows at offset 0, nothing after — as a real short read ends.
    range: async (from: number) => ({
      data: error ? null : from === 0 ? rows : [],
      error,
    }),
  };
  return builder;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    rpc: async (name: string) => {
      state.rpcCalls.push(name);
      return { data: state.editableIds, error: null };
    },
    from: (table: string) =>
      table === 'publishes'
        ? pageOf(state.notes, state.notesError)
        : pageOf([]),
  }),
}));

beforeEach(() => {
  state.notes = [
    { id: 'p1', analytics_note: null },
    { id: 'p2', analytics_note: null },
  ];
  state.notesError = null;
  state.editableIds = [];
  state.rpcCalls = [];
});

const input = {
  projectId: '00000000-0000-4000-8000-000000000001',
  checkpoints: [30],
  limit: 200,
  offset: 0,
  orderBy: 'published_at' as const,
  orderDirection: 'desc' as const,
};

describe('getVideoLogAction — analytics notes', () => {
  it('attaches each video its own note, and null to a video without one', async () => {
    state.notes[0]!.analytics_note = 'Swapped thumbnail on day 3';

    const rows = await getVideoLogAction(input);

    expect(rows.map((row) => [row.videoId, row.analyticsNote])).toEqual([
      ['p1', 'Swapped thumbnail on day 3'],
      ['p2', null],
    ]);
  });

  it('fails the log rather than showing every note as missing when the read fails', async () => {
    state.notesError = { message: 'notes read failed' };

    await expect(getVideoLogAction(input)).rejects.toThrow();
  });

  it('says per video whether the caller may edit its note, by the publishes_update rule', async () => {
    // The database answers, from the same rule as publishes_update; the
    // two are checked against each other in experiments-integrity.test.sql.
    state.editableIds = ['p1'];

    const rows = await getVideoLogAction(input);

    expect(state.rpcCalls).toEqual(['editable_publish_ids']);

    expect(rows.map((row) => [row.videoId, row.canEditNote])).toEqual([
      ['p1', true],
      ['p2', false],
    ]);
  });
});
