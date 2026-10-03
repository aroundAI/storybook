import type { SupabaseClient } from '@supabase/supabase-js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logLLMUsage } from '../src/analytics';

/**
 * FILM-1902 / FILM-1903: a usage row names the generation run it belongs to.
 * Since FILM-1903 part C the database refuses a row without one, so the
 * event type requires it rather than letting a caller find out at runtime.
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

  it('inserts a null template_slug for a call with no prompt, such as an embedding', async () => {
    const { templateSlug: _omitted, ...withoutPrompt } = event;

    await logLLMUsage(client, {
      ...withoutPrompt,
      runId: '33333333-3333-4333-8333-333333333333',
    });

    expect(insert.mock.calls[0]?.[0]).toMatchObject({ template_slug: null });
  });

  it('an event without a runId does not type-check', () => {
    // @ts-expect-error runId is required: a usage row without a run is refused
    const withoutRun: Parameters<typeof logLLMUsage>[1] = event;

    expect(withoutRun).not.toHaveProperty('runId');
  });
});
