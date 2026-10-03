import { beforeEach, describe, expect, it } from 'vitest';

import { analyticsTools } from '../src/server/tools/analytics';
import {
  type FakeDb,
  type Row,
  callTool,
  contextFor,
  fakeClient,
} from './helpers/fake-postgrest';

/**
 * FILM-1906 criterion 7: get_ai_usage reads `llm_usage_analytics` on the
 * principal's client (its `has_account_access` policy decides the rows) and
 * splits by run mode through `generation_runs.mode` once FILM-1903's
 * `run_id` column exists. Before that the column is absent and the split
 * is null with the reason — detected from PostgREST's 42703, not assumed.
 */

const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';

const usage = (id: string, extra: Row = {}): Row => ({
  id,
  account_id: ACCOUNT,
  created_at: '2026-09-15T10:00:00.000Z',
  llm_provider: 'google',
  llm_model: 'gemini-2.5-pro',
  template_slug: 'story-generation',
  operation_name: null,
  status: 'success',
  prompt_tokens: 1000,
  completion_tokens: 500,
  total_tokens: 1500,
  total_cost: 0.02,
  ...extra,
});

function tool(db: FakeDb, runColumn: boolean) {
  const client = fakeClient(db);
  const from = client.from.bind(client);

  // Without the column, PostgREST refuses the probing select with 42703.
  client.from = (table: string) => {
    const chain = from(table);

    if (table === 'llm_usage_analytics' && !runColumn) {
      const limit = chain.limit.bind(chain);
      chain.limit = (count: number) => {
        limit(count);
        chain.then = <R>(onfulfilled: (value: never) => R) =>
          Promise.resolve({
            data: null,
            error: {
              code: '42703',
              message: 'column llm_usage_analytics.run_id does not exist',
            },
          } as never).then(onfulfilled);
        return chain;
      };
    }

    return chain;
  };

  return (args: Record<string, unknown> = {}) =>
    callTool(
      analyticsTools,
      'get_ai_usage',
      args,
      contextFor(client, { id: ACCOUNT, slug: 'a' }),
    );
}

let db: FakeDb;

beforeEach(() => {
  db = {
    llm_usage_analytics: [
      usage('u1'),
      usage('u2', {
        total_cost: null,
        status: 'error',
        llm_model: 'gemini-2.5-flash',
      }),
      usage('u3', { run_id: 'r1', generation_runs: { mode: 'external' } }),
      usage('u4', { created_at: '2026-08-01T00:00:00.000Z' }),
    ],
  };
});

describe('get_ai_usage', () => {
  it('totals the window’s rows, with cost null where none measured it', async () => {
    const result = await tool(
      db,
      true,
    )({ from: '2026-09-01', to: '2026-09-30' });
    const content = result.structuredContent as {
      totals: { calls: number; totalTokens: number; totalCost: number | null };
      byStatus: Array<{ key: string; calls: number; totalCost: number | null }>;
      byModel: Array<{ key: string; calls: number }>;
    };

    expect(content.totals).toMatchObject({ calls: 3, totalTokens: 4500 });
    expect(content.totals.totalCost).toBeCloseTo(0.04);
    expect(
      content.byStatus.find((bucket) => bucket.key === 'error'),
    ).toMatchObject({
      calls: 1,
      totalCost: null,
    });
    expect(content.byModel.map((bucket) => bucket.key)).toEqual([
      'google/gemini-2.5-pro',
      'google/gemini-2.5-flash',
    ]);
  });

  it('splits by run mode when usage rows carry a run', async () => {
    const result = await tool(
      db,
      true,
    )({ from: '2026-09-01', to: '2026-09-30' });
    const content = result.structuredContent as {
      byMode: Array<{ key: string; calls: number }>;
      notes: { byModeReason: string | null };
    };

    expect(content.byMode).toEqual([
      expect.objectContaining({ key: 'unattributed', calls: 2 }),
      expect.objectContaining({ key: 'external', calls: 1 }),
    ]);
    expect(content.notes.byModeReason).toBeNull();
  });

  it('without the run_id column, byMode is null and names FILM-1903', async () => {
    const result = await tool(
      db,
      false,
    )({ from: '2026-09-01', to: '2026-09-30' });
    const content = result.structuredContent as {
      totals: { calls: number };
      byMode: unknown;
      notes: { byModeReason: string | null };
    };

    expect(content.totals.calls).toBe(3);
    expect(content.byMode).toBeNull();
    expect(content.notes.byModeReason).toContain('FILM-1903');
  });

  it('has no cost figure of 0 standing in for "not measured"', async () => {
    db.llm_usage_analytics = [usage('u1', { total_cost: null })];
    const result = await tool(
      db,
      true,
    )({ from: '2026-09-01', to: '2026-09-30' });

    expect(
      (result.structuredContent as { totals: { totalCost: unknown } }).totals
        .totalCost,
    ).toBeNull();
  });
});
