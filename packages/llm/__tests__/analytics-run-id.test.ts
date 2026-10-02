import type { SupabaseClient } from '@supabase/supabase-js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logLLMUsage } from '../src/analytics';

/**
 * FILM-1902 / FILM-1903: a usage row names the generation run it belongs to.
 * The `run_id` column lands with FILM-1903 part A; until a caller has a run
 * id, the insert must not mention the column at all, or every row would be
 * refused on a schema that lacks it.
 */

const insert = vi.fn(async (_row: Record<string, unknown>) => ({
  error: null,
}));
const client = {
  from: () => ({ insert }),
} as unknown as SupabaseClient;

const event = {
  accountId: '11111111-1111-4111-8111-111111111111',
  templateSlug: 'probe',
  operationName: 'probe',
  llmProvider: 'gemini',
  llmModel: 'm',
  promptTokens: 1,
  completionTokens: 1,
  totalTokens: 2,
  latencyMs: 5,
  status: 'success' as const,
};

describe('logLLMUsage and run_id', () => {
  beforeEach(() => {
    insert.mockClear();
  });

  it('writes run_id when the event carries a runId', async () => {
    await logLLMUsage(client, {
      ...event,
      runId: '33333333-3333-4333-8333-333333333333',
    });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0]?.[0]).toMatchObject({
      run_id: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('leaves run_id out of the insert when the event has none', async () => {
    await logLLMUsage(client, event);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0]?.[0]).not.toHaveProperty('run_id');
  });
});
