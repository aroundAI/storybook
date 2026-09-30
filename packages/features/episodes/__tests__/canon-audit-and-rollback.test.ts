import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionRefusal } from '@kit/next/action-result';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CanonConflictError,
  CanonError,
  CanonNotFoundError,
  CanonPermissionError,
  CanonValidationError,
} from '../src/lib/canon/canon-errors';
import {
  deleteImmutableEventAction,
  rollbackCharacterStateAction,
  updateNarrativeThreadAction,
} from '../src/server/canon-actions';

// FILM-1005. Deletes and thread edits are written to state_deltas, a
// character-state change can be rolled back from its delta, and every
// refusal reaches the caller as a value (KB-6: a thrown message is replaced
// in a production build).

const CALLER = '00000000-0000-4000-8000-0000000000aa';
const EPISODE = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const DELTA = '44444444-4444-4444-8444-444444444444';
const THREAD = '55555555-5555-4555-8555-555555555555';

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

const writes: Array<{ table: string; op: string; row: unknown }> = [];

function clientReturning(...results: Result[]) {
  const from = vi.fn((table: string) => {
    const result = results.shift() ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};

    for (const method of ['select', 'eq', 'order', 'limit', 'single', 'delete']) {
      chain[method] = vi.fn(() => chain);
    }

    for (const op of ['insert', 'update']) {
      chain[op] = vi.fn((row: unknown) => {
        writes.push({ table, op, row });
        return chain;
      });
    }

    chain.then = (resolve: (value: Result) => unknown) => resolve(result);

    return chain;
  });

  vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);

  return from;
}

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('canon errors', () => {
  it('are refusals, each with its own code', () => {
    const errors = [
      new CanonNotFoundError('a'),
      new CanonConflictError('b'),
      new CanonValidationError('c'),
      new CanonPermissionError('d'),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(ActionRefusal);
      expect(error).toBeInstanceOf(CanonError);
    }

    expect(errors.map((e) => e.code)).toEqual([
      'CANON_NOT_FOUND',
      'CANON_CONFLICT',
      'CANON_VALIDATION',
      'CANON_FORBIDDEN',
    ]);
    expect(errors.map((e) => e.name)).toEqual([
      'CanonNotFoundError',
      'CanonConflictError',
      'CanonValidationError',
      'CanonPermissionError',
    ]);
  });
});

describe('deleteImmutableEventAction audit (FILM-1005)', () => {
  const input = {
    eventId: '66666666-6666-4666-8666-666666666666',
    confirm: true,
  };

  it('records the deleted event in state_deltas', async () => {
    clientReturning(
      {
        data: [
          {
            id: input.eventId,
            event_type: 'death',
            event_key: 'character:mara:dead',
            description: 'Mara dies',
            established_in: EPISODE,
          },
        ],
        error: null,
      },
      { data: null, error: null },
    );

    await deleteImmutableEventAction(input);

    expect(writes).toEqual([
      {
        table: 'state_deltas',
        op: 'insert',
        row: {
          episode_id: EPISODE,
          entity_type: 'immutable',
          entity_id: input.eventId,
          before_state: {
            eventType: 'death',
            eventKey: 'character:mara:dead',
            description: 'Mara dies',
          },
          after_state: null,
          change_reason: 'Immutable event "character:mara:dead" deleted',
        },
      },
    ]);
  });

  it('writes no delta for a delete that matched nothing', async () => {
    clientReturning({ data: [], error: null });

    await expect(deleteImmutableEventAction(input)).resolves.toEqual({
      ok: false,
      error: "You can't change this project's canon.",
    });
    expect(writes).toEqual([]);
  });

  it('returns the missing confirmation as a value', async () => {
    clientReturning();

    await expect(
      deleteImmutableEventAction({ ...input, confirm: false }),
    ).resolves.toEqual({
      ok: false,
      error: 'Deletion requires confirmation. Set confirm: true to proceed.',
    });
  });
});

describe('updateNarrativeThreadAction audit (FILM-1005)', () => {
  const edit = {
    threadId: THREAD,
    expectedVersion: 2,
    status: 'resolved' as const,
  };

  const current = {
    id: THREAD,
    status: 'open',
    payoffs: [],
    episodes_touched: [],
    version: 2,
    opened_at: EPISODE,
  };

  it('records the before and after of the edit', async () => {
    clientReturning(
      { data: current, error: null },
      {
        data: { ...current, status: 'resolved', version: 3, thread_name: 't' },
        error: null,
      },
      { data: null, error: null },
    );

    await expect(updateNarrativeThreadAction(edit)).resolves.toMatchObject({
      ok: true,
    });

    expect(writes[1]).toEqual({
      table: 'state_deltas',
      op: 'insert',
      row: {
        episode_id: EPISODE,
        entity_type: 'thread',
        entity_id: THREAD,
        before_state: { status: 'open', payoffs: [], version: 2 },
        after_state: { status: 'resolved', payoffs: [], version: 3 },
        change_reason: 'Thread status open -> resolved',
      },
    });
  });

  it('returns a stale version as a refusal, and writes nothing', async () => {
    clientReturning({ data: { ...current, version: 5 }, error: null });

    await expect(updateNarrativeThreadAction(edit)).resolves.toEqual({
      ok: false,
      error: 'Thread was modified by another user. Please refresh and try again.',
    });
    expect(writes).toEqual([]);
  });

  it('returns a missing thread as a refusal', async () => {
    clientReturning({ data: null, error: { code: 'PGRST116', message: 'none' } });

    await expect(updateNarrativeThreadAction(edit)).resolves.toEqual({
      ok: false,
      error: 'Thread not found.',
    });
  });

  it('returns the canon-write refusal when row-level security refuses the update', async () => {
    clientReturning(
      { data: current, error: null },
      { data: null, error: { code: '42501', message: 'rls' } },
    );

    await expect(updateNarrativeThreadAction(edit)).resolves.toEqual({
      ok: false,
      error: "You can't change this project's canon.",
    });
  });

  it('still throws a failed read', async () => {
    clientReturning({ data: null, error: { code: '57014', message: 'timeout' } });

    await expect(updateNarrativeThreadAction(edit)).rejects.toThrow(
      'Thread not found: the read failed (timeout)',
    );
  });
});

describe('rollbackCharacterStateAction (FILM-1005)', () => {
  const delta = {
    id: DELTA,
    episode_id: EPISODE,
    entity_type: 'character',
    entity_id: CHARACTER,
    before_state: { mood: 'calm' },
    after_state: { mood: 'grieving' },
    created_at: '2026-01-02T00:00:00Z',
  };

  const applied = {
    id: 'state-2',
    state_type: 'emotional',
    state_value: { mood: 'grieving' },
    episode_id: EPISODE,
    created_at: '2026-01-02T00:00:00Z',
  };

  it('appends a state that restores the before state, and records it', async () => {
    clientReturning(
      { data: delta, error: null },
      { data: [applied], error: null },
      { data: null, error: null },
      { data: null, error: null },
    );

    await expect(
      rollbackCharacterStateAction({ deltaId: DELTA }),
    ).resolves.toEqual({ ok: true, data: { restoredStateType: 'emotional' } });

    expect(writes).toEqual([
      {
        table: 'character_states',
        op: 'insert',
        row: {
          character_id: CHARACTER,
          episode_id: EPISODE,
          state_type: 'emotional',
          state_value: { mood: 'calm' },
          trigger_event: `Rollback of state change ${DELTA}`,
          previous_state_id: 'state-2',
          created_by: CALLER,
        },
      },
      {
        table: 'state_deltas',
        op: 'insert',
        row: {
          episode_id: EPISODE,
          entity_type: 'character',
          entity_id: CHARACTER,
          before_state: { mood: 'grieving' },
          after_state: { mood: 'calm' },
          change_reason: `Rollback of state change ${DELTA}`,
        },
      },
    ]);
  });

  it('refuses when the character changed again after this change', async () => {
    const later = {
      ...applied,
      id: 'state-3',
      state_value: { mood: 'furious' },
    };
    clientReturning(
      { data: delta, error: null },
      { data: [later, applied], error: null },
    );

    await expect(
      rollbackCharacterStateAction({ deltaId: DELTA }),
    ).resolves.toEqual({
      ok: false,
      error:
        'The character changed again after this. Roll back the later change first.',
    });
    expect(writes).toEqual([]);
  });

  it('does not treat a later change of another state type as a conflict', async () => {
    const otherType = {
      ...applied,
      id: 'state-3',
      state_type: 'physical',
      state_value: { hurt: true },
    };
    clientReturning(
      { data: delta, error: null },
      { data: [otherType, applied], error: null },
      { data: null, error: null },
      { data: null, error: null },
    );

    await expect(
      rollbackCharacterStateAction({ deltaId: DELTA }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('refuses the first state recorded: there is nothing to restore', async () => {
    clientReturning({ data: { ...delta, before_state: null }, error: null });

    await expect(
      rollbackCharacterStateAction({ deltaId: DELTA }),
    ).resolves.toEqual({
      ok: false,
      error:
        'This was the first state recorded for the character; there is nothing to restore.',
    });
  });

  it('refuses a delta that is not about a character', async () => {
    clientReturning({ data: { ...delta, entity_type: 'thread' }, error: null });

    await expect(
      rollbackCharacterStateAction({ deltaId: DELTA }),
    ).resolves.toEqual({
      ok: false,
      error: 'Only a character state change can be rolled back.',
    });
  });

  it('refuses an unknown delta', async () => {
    clientReturning({ data: null, error: { code: 'PGRST116', message: 'none' } });

    await expect(
      rollbackCharacterStateAction({ deltaId: DELTA }),
    ).resolves.toEqual({ ok: false, error: 'State change not found.' });
  });

  it('refuses when the state the change produced is gone', async () => {
    clientReturning(
      { data: delta, error: null },
      { data: [{ ...applied, state_value: { mood: 'other' } }], error: null },
    );

    await expect(
      rollbackCharacterStateAction({ deltaId: DELTA }),
    ).resolves.toEqual({
      ok: false,
      error: 'The state this change produced no longer exists.',
    });
  });

  it('returns the canon-write refusal to a reader who is not a writer', async () => {
    clientReturning(
      { data: delta, error: null },
      { data: [applied], error: null },
      { data: null, error: { code: '42501', message: 'rls' } },
    );

    await expect(
      rollbackCharacterStateAction({ deltaId: DELTA }),
    ).resolves.toEqual({
      ok: false,
      error: "You can't change this project's canon.",
    });
    expect(writes.map((w) => w.table)).toEqual(['character_states']);
  });
});
