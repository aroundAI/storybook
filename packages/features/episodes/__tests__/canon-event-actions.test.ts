import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  addImmutableEventAction,
  deleteImmutableEventAction,
} from '../src/server/canon-actions';

// KB-17: the database refuses canon writes to anyone who is not a writer on
// the project. These check that the refusal reaches the user as a value
// (KB-6: a thrown message is replaced in a production build), and that a
// delete which matched nothing is not reported as a success.

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock('@kit/next/actions', () => ({
  checkRateLimit: vi.fn(),
  enhanceAction: vi.fn(
    (fn: (data: unknown, user: { id: string }) => unknown) => (data: unknown) =>
      fn(data, { id: '00000000-0000-4000-8000-0000000000aa' }),
  ),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

type Result = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

/** A PostgREST query builder: every call chains, and awaiting it settles. */
function query(result: Result) {
  const chain: Record<string, unknown> = {};

  for (const method of ['select', 'insert', 'delete', 'eq', 'single']) {
    chain[method] = vi.fn(() => chain);
  }

  chain.then = (resolve: (value: Result) => unknown) => resolve(result);

  return chain;
}

function clientReturning(...results: Result[]) {
  const from = vi.fn();

  for (const result of results) {
    from.mockReturnValueOnce(query(result));
  }

  vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);
}

const REFUSAL = "You can't change this project's canon.";

const EVENT = {
  projectId: '11111111-1111-4111-8111-111111111111',
  eventType: 'death' as const,
  eventKey: 'character:mara:dead',
  establishedIn: '22222222-2222-4222-8222-222222222222',
  season: 1,
  episodeNumber: 1,
  description: 'Mara dies defending the gate',
};

describe('addImmutableEventAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the canon-write refusal when row-level security refuses the insert', async () => {
    clientReturning(
      { data: null, error: null },
      {
        data: null,
        error: {
          code: '42501',
          message:
            'new row violates row-level security policy for table "immutable_events"',
        },
      },
    );

    await expect(addImmutableEventAction(EVENT)).resolves.toEqual({
      ok: false,
      error: REFUSAL,
    });
  });

  it('still throws any other database failure', async () => {
    clientReturning(
      { data: null, error: null },
      { data: null, error: { code: '23505', message: 'duplicate key' } },
    );

    await expect(addImmutableEventAction(EVENT)).rejects.toThrow(
      'Failed to add immutable event',
    );
  });
});

describe('deleteImmutableEventAction', () => {
  beforeEach(() => vi.clearAllMocks());

  const input = {
    eventId: '33333333-3333-4333-8333-333333333333',
    confirm: true,
  };

  it('returns the refusal when the delete matched no row', async () => {
    clientReturning({ data: [], error: null });

    await expect(deleteImmutableEventAction(input)).resolves.toEqual({
      ok: false,
      error: REFUSAL,
    });
  });

  it('reports success when the event was deleted', async () => {
    clientReturning({ data: [{ id: input.eventId }], error: null });

    await expect(deleteImmutableEventAction(input)).resolves.toEqual({
      ok: true,
      data: { success: true },
    });
  });
});
