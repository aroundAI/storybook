import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  createNarrativeThreadAction,
  updateCharacterStateAction,
} from '../src/server/canon-actions';

// KB-76/77: the database refuses canon writes to anyone who is not a writer
// on the project, and a character state must name its inserter. These check
// that the refusal reaches the user as a value (KB-6) and that the action
// states its author.

const CALLER = '00000000-0000-4000-8000-0000000000aa';

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock('@kit/next/actions', () => ({
  checkRateLimit: vi.fn(),
  enhanceAction: vi.fn(
    (fn: (data: unknown, user: { id: string }) => unknown) => (data: unknown) =>
      fn(data, { id: CALLER }),
  ),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

type Result = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

const inserts: Array<{ table: string; row: unknown }> = [];

function clientReturning(...results: Result[]) {
  const from = vi.fn((table: string) => {
    const result = results.shift() ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};

    for (const method of ['select', 'eq', 'order', 'limit', 'single']) {
      chain[method] = vi.fn(() => chain);
    }

    chain.insert = vi.fn((row: unknown) => {
      inserts.push({ table, row });
      return chain;
    });
    chain.then = (resolve: (value: Result) => unknown) => resolve(result);

    return chain;
  });

  vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);
}

const REFUSAL = "You can't change this project's canon.";
const RLS_REFUSAL = {
  code: '42501',
  message: 'new row violates row-level security policy',
};

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
});

describe('createNarrativeThreadAction', () => {
  const thread = {
    projectId: '11111111-1111-4111-8111-111111111111',
    threadName: 'The missing key',
    threadType: 'mystery' as const,
    openedAt: '22222222-2222-4222-8222-222222222222',
  };

  it('returns the canon-write refusal when row-level security refuses the insert', async () => {
    clientReturning({ data: null, error: RLS_REFUSAL });

    await expect(createNarrativeThreadAction(thread)).resolves.toEqual({
      ok: false,
      error: REFUSAL,
    });
  });

  it('still throws any other database failure', async () => {
    clientReturning({
      data: null,
      error: { code: '23503', message: 'foreign key' },
    });

    await expect(createNarrativeThreadAction(thread)).rejects.toThrow(
      'Failed to create narrative thread',
    );
  });
});

describe('updateCharacterStateAction', () => {
  const change = {
    characterId: '33333333-3333-4333-8333-333333333333',
    episodeId: '22222222-2222-4222-8222-222222222222',
    stateType: 'emotional' as const,
    stateValue: { mood: 'grieving' },
    triggerEvent: 'Her brother dies',
  };

  it('records the caller as the author of the state', async () => {
    clientReturning(
      { data: null, error: null },
      { data: { id: 'state' }, error: null },
      { data: null, error: null },
    );

    await expect(updateCharacterStateAction(change)).resolves.toMatchObject({
      ok: true,
    });

    expect(inserts[0]).toMatchObject({
      table: 'character_states',
      row: { created_by: CALLER },
    });
  });

  it('returns the canon-write refusal when row-level security refuses the insert', async () => {
    clientReturning(
      { data: null, error: null },
      { data: null, error: RLS_REFUSAL },
    );

    await expect(updateCharacterStateAction(change)).resolves.toEqual({
      ok: false,
      error: REFUSAL,
    });
  });

  it('fails instead of ignoring a state delta the database refused', async () => {
    clientReturning(
      { data: null, error: null },
      { data: { id: 'state' }, error: null },
      { data: null, error: { code: '23503', message: 'foreign key' } },
    );

    await expect(updateCharacterStateAction(change)).rejects.toThrow(
      'Failed to record state delta',
    );
  });
});
