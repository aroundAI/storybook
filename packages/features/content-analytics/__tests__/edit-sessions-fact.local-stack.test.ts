import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getClickHouseClient } from '@kit/clickhouse/server';

import { syncEditSessionFacts } from '../src/server/edit-sessions-fact-sync';

/**
 * FILM-2006: the edit-session rollup against a real ClickHouse.
 *
 * Postgres is a fixture here — three delivered sessions, as deliver_edit
 * stores them — because the subject is what reaches `edit_sessions_fact`:
 * one row per delivered session, the same figures `deriveEditStyle` gives,
 * nulls kept null, and a second run adding nothing. The Playwright spec
 * (apps/e2e/tests/mcp/edit-record.spec.ts) drives the same rollup through
 * the sync route after a real delivery over MCP.
 *
 * Off unless asked for; needs `./scripts/local-env.sh up` and migration 024
 * applied to the database CLICKHOUSE_DB names:
 *
 *   set -a; . deployment/config/local.env; set +a
 *   EDIT_FACT_LOCAL_STACK=1 pnpm --filter @kit/content-analytics test edit-sessions-fact.local-stack
 */
const PROJECT = '20060000-0000-4000-8000-0000000000f1';
const ACCOUNT = '20060000-0000-4000-8000-0000000000f2';
const EPISODE_A = '20060000-0000-4000-8000-0000000000f3';
const EPISODE_B = '20060000-0000-4000-8000-0000000000f4';
const RENDER_16x9 = '20060000-0000-4000-8000-0000000000d1';
const RENDER_9x16 = '20060000-0000-4000-8000-0000000000d2';
const RENDER_HI = '20060000-0000-4000-8000-0000000000d3';

const report = (figures: Record<string, unknown>) => ({
  versions: [
    {
      id: 'v1',
      label: 'Rough cut',
      parentId: null,
      createdAt: '2026-10-04T10:00:00Z',
      origin: 'rough_cut',
    },
  ],
  finalDuration: 90,
  aiOps: 12,
  userOps: 4,
  explain: { scenes: [] },
  ...figures,
});

const SESSIONS = [
  {
    // 16 shots over 90 s: 15 cuts, 5.625 s a shot, 10 cuts a minute; 12/16 AI
    id: '20060000-0000-4000-8000-0000000000b1',
    episode_id: EPISODE_A,
    delivered_at: '2026-10-04T09:00:00.000+00:00',
    summary: {
      versions: 1,
      aiOps: 12,
      userOps: 4,
      plansProposed: 3,
      plansApproved: 2,
      qaRuns: 1,
      report: report({ style: { shotCount: 16, hookType: 'cold-open' } }),
      renders: [
        { renderId: RENDER_16x9, primary: true },
        { renderId: RENDER_9x16, primary: false },
      ],
    },
  },
  {
    // No style in the report: cut figures and hook unknown; no ops: no share
    id: '20060000-0000-4000-8000-0000000000b2',
    episode_id: EPISODE_B,
    delivered_at: '2026-10-04T10:30:00.000+00:00',
    summary: {
      versions: 1,
      aiOps: 0,
      userOps: 0,
      report: report({ finalDuration: 30, aiOps: 0, userOps: 0 }),
      renders: [{ renderId: RENDER_HI, primary: true }],
    },
  },
  {
    // A delivered row with an unreadable report is skipped, not zero-filled
    id: '20060000-0000-4000-8000-0000000000b3',
    episode_id: EPISODE_B,
    delivered_at: '2026-10-04T11:00:00.000+00:00',
    summary: { versions: 1 },
  },
];

const TABLES: Record<string, Array<Record<string, unknown>>> = {
  edit_sessions: SESSIONS.map((session) => ({
    ...session,
    status: 'delivered',
  })),
  episodes: [
    {
      id: EPISODE_A,
      project_id: PROJECT,
      target_duration_seconds: 95,
      project: { account_id: ACCOUNT },
    },
    {
      id: EPISODE_B,
      project_id: PROJECT,
      target_duration_seconds: null,
      project: { account_id: ACCOUNT },
    },
  ],
  episode_renders: [
    { id: RENDER_16x9, preset: 'youtube_16x9', language: 'en' },
    { id: RENDER_9x16, preset: 'shorts_9x16', language: 'en' },
    { id: RENDER_HI, preset: 'youtube_16x9', language: 'hi' },
  ],
};

/** A PostgREST builder over the fixture: eq, in, gte, order and range. */
function fixtureClient() {
  return {
    from(table: string) {
      let rows = [...(TABLES[table] ?? [])];
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] === value);
          return builder;
        },
        in: (column: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[column]));
          return builder;
        },
        gte: (column: string, value: string) => {
          rows = rows.filter(
            (row) => Date.parse(String(row[column])) >= Date.parse(value),
          );
          return builder;
        },
        order: (column: string) => {
          rows.sort((a, b) =>
            String(a[column]).localeCompare(String(b[column])),
          );
          return builder;
        },
        range: (from: number, to: number) =>
          Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
      };
      return builder;
    },
  } as never;
}

async function factRows() {
  const result = await getClickHouseClient().query({
    query: `
      SELECT toString(session_id) as session_id, final_duration, target_duration,
             ai_ops, user_ops, plans_proposed, plans_approved, cut_count,
             avg_shot_length, hook_type, cuts_per_minute, ai_share,
             languages, presets
      FROM edit_sessions_fact FINAL
      WHERE project_id = {p:UUID}
      ORDER BY session_id`,
    query_params: { p: PROJECT },
    format: 'JSONEachRow',
  });

  return result.json<Record<string, unknown>>();
}

async function clear() {
  await getClickHouseClient().command({
    query: 'ALTER TABLE edit_sessions_fact DELETE WHERE project_id = {p:UUID}',
    query_params: { p: PROJECT },
    clickhouse_settings: { mutations_sync: '2' },
  });
}

describe.skipIf(!process.env.EDIT_FACT_LOCAL_STACK)(
  'syncEditSessionFacts against the local ClickHouse',
  () => {
    beforeAll(clear);
    afterAll(clear);

    it('writes one row per delivered session, and a second run adds none', async () => {
      const now = new Date('2026-10-04T12:00:00Z');
      const first = await syncEditSessionFacts(fixtureClient(), { now });

      expect(first).toEqual({
        enabled: true,
        delivered: 3,
        written: 2,
        skipped: 1,
      });

      const expected = [
        {
          session_id: SESSIONS[0]!.id,
          final_duration: 90,
          target_duration: 95,
          ai_ops: 12,
          user_ops: 4,
          plans_proposed: 3,
          plans_approved: 2,
          cut_count: 15,
          avg_shot_length: 5.625,
          hook_type: 'cold-open',
          cuts_per_minute: 10,
          ai_share: 0.75,
          languages: ['en'],
          presets: ['shorts_9x16', 'youtube_16x9'],
        },
        {
          session_id: SESSIONS[1]!.id,
          final_duration: 30,
          target_duration: null,
          ai_ops: 0,
          user_ops: 0,
          plans_proposed: null,
          plans_approved: null,
          cut_count: null,
          avg_shot_length: null,
          hook_type: null,
          cuts_per_minute: null,
          ai_share: null,
          languages: ['hi'],
          presets: ['youtube_16x9'],
        },
      ];

      expect(await factRows()).toEqual(expected);

      const second = await syncEditSessionFacts(fixtureClient(), { now });

      expect(second.written).toBe(2);
      expect(await factRows()).toEqual(expected);
    });

    it('the hourly window leaves out a delivery older than 48 hours; the daily full run takes it', async () => {
      await clear();
      const later = new Date('2026-10-07T12:00:00Z');

      const hourly = await syncEditSessionFacts(fixtureClient(), {
        now: later,
      });
      expect(hourly).toMatchObject({ delivered: 0, written: 0 });
      expect(await factRows()).toHaveLength(0);

      const full = await syncEditSessionFacts(fixtureClient(), {
        now: later,
        full: true,
      });
      expect(full).toMatchObject({ delivered: 3, written: 2 });
      expect(await factRows()).toHaveLength(2);
    });
  },
);
