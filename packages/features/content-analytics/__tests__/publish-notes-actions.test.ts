import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdatePublishNoteSchema } from '../src/lib/schemas/publish-note.schema';
import { updatePublishNoteAction } from '../src/server/publish-notes-actions';

const PUBLISH = '0b6f5a4e-3c1d-4e2f-9a8b-7c6d5e4f3a2b';
const STAMP = '2026-09-20T10:00:00.123456+00:00';

const state: {
  /** Rows the conditional update matched; empty is a refusal or a conflict. */
  matched: Array<{
    id: string;
    analytics_note: string | null;
    analytics_note_updated_at: string | null;
  }>;
  written: Record<string, unknown> | null;
  /** The conditions the update carried, as [method, column, value]. */
  conditions: Array<[string, string, unknown]>;
  /** The note as it stands when read back after a zero-row update. */
  current: {
    analytics_note: string | null;
    analytics_note_updated_at: string | null;
  } | null;
  /** What `editable_publish_ids` returns for the caller. */
  editable: string[];
  readError: { message: string } | null;
} = {
  matched: [],
  written: null,
  conditions: [],
  current: null,
  editable: [],
  readError: null,
};

vi.mock('@kit/next/actions', () => ({
  // Parse through the real schema, as enhanceAction does, so the transform
  // under test is the one the action receives.
  enhanceAction:
    (
      handler: (data: unknown, user: unknown) => unknown,
      options: { schema: { parse: (value: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options.schema.parse(data), { id: 'u1' }),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

function updateChain() {
  const chain = {
    eq: (column: string, value: unknown) => {
      state.conditions.push(['eq', column, value]);
      return chain;
    },
    is: (column: string, value: unknown) => {
      state.conditions.push(['is', column, value]);
      return chain;
    },
    select: async () => ({ data: state.matched, error: null }),
  };
  return chain;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        state.written = payload;
        return updateChain();
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: state.current,
            error: state.readError,
          }),
        }),
      }),
    }),
    rpc: async () => ({ data: state.editable, error: null }),
  }),
}));

beforeEach(() => {
  state.matched = [];
  state.written = null;
  state.conditions = [];
  state.current = null;
  state.editable = [];
  state.readError = null;
});

describe('updatePublishNoteAction', () => {
  it('writes only the note, leaving its author and time to the database', async () => {
    state.matched = [
      {
        id: PUBLISH,
        analytics_note: 'Swapped thumbnail',
        analytics_note_updated_at: STAMP,
      },
    ];

    const result = await updatePublishNoteAction({
      publishId: PUBLISH,
      note: 'Swapped thumbnail',
      expectedUpdatedAt: null,
    });

    // Only the note: its author and time are set by the database
    // (publishes_analytics_note_audit), so a caller cannot claim either.
    expect(state.written).toEqual({ analytics_note: 'Swapped thumbnail' });
    expect(result).toEqual({
      ok: true,
      data: {
        status: 'saved',
        publishId: PUBLISH,
        note: 'Swapped thumbnail',
        updatedAt: STAMP,
      },
    });
  });

  it('writes a first note only while there is still no note (FILM-1615)', async () => {
    state.matched = [
      {
        id: PUBLISH,
        analytics_note: 'First',
        analytics_note_updated_at: STAMP,
      },
    ];

    await updatePublishNoteAction({
      publishId: PUBLISH,
      note: 'First',
      expectedUpdatedAt: null,
    });

    expect(state.conditions).toContainEqual([
      'is',
      'analytics_note_updated_at',
      null,
    ]);
  });

  it('writes an edit only while the note still has the time the editor read — exactly', async () => {
    state.matched = [
      { id: PUBLISH, analytics_note: 'Second', analytics_note_updated_at: 'x' },
    ];

    await updatePublishNoteAction({
      publishId: PUBLISH,
      note: 'Second',
      expectedUpdatedAt: STAMP,
    });

    // The string as Postgres returned it: through a Date it would lose the
    // microseconds and never match.
    expect(state.conditions).toContainEqual([
      'eq',
      'analytics_note_updated_at',
      STAMP,
    ]);
  });

  it('reports a conflict, with the other edit, when someone changed the note first', async () => {
    state.matched = [];
    state.current = {
      analytics_note: 'Their note',
      analytics_note_updated_at: '2026-09-20T11:00:00.5+00:00',
    };
    state.editable = [PUBLISH];

    expect(
      await updatePublishNoteAction({
        publishId: PUBLISH,
        note: 'Mine',
        expectedUpdatedAt: STAMP,
      }),
    ).toEqual({
      ok: true,
      data: {
        status: 'conflict',
        publishId: PUBLISH,
        note: 'Their note',
        updatedAt: '2026-09-20T11:00:00.5+00:00',
      },
    });
  });

  it('reports a refused write as a refusal, not a save or a conflict', async () => {
    // RLS refusing an update matches zero rows and returns 200 with no error.
    state.matched = [];
    state.current = { analytics_note: null, analytics_note_updated_at: null };
    state.editable = [];

    // Returned, not thrown: a production build would replace a thrown
    // message with a generic sentence (FILM-1610 review 4, G1).
    expect(
      await updatePublishNoteAction({
        publishId: PUBLISH,
        note: 'Hello',
        expectedUpdatedAt: null,
      }),
    ).toEqual({
      ok: false,
      error:
        'You cannot edit notes on this video. Notes can be changed by members of its project.',
    });
  });

  it('fails, rather than guessing, when the read-back fails', async () => {
    state.readError = { message: 'boom' };

    const result = await updatePublishNoteAction({
      publishId: PUBLISH,
      note: 'Hello',
      expectedUpdatedAt: null,
    });

    expect(result.ok).toBe(false);
  });
});

describe('UpdatePublishNoteSchema', () => {
  const base = { publishId: PUBLISH, expectedUpdatedAt: null };

  it('stores a blank or whitespace note as no note', () => {
    expect(UpdatePublishNoteSchema.parse({ ...base, note: '   ' }).note).toBe(
      null,
    );
    expect(UpdatePublishNoteSchema.parse({ ...base, note: '' }).note).toBe(
      null,
    );
  });

  it('keeps a real note exactly as written', () => {
    expect(
      UpdatePublishNoteSchema.parse({ ...base, note: '  Day 3: new hook ' })
        .note,
    ).toBe('  Day 3: new hook ');
  });

  it('refuses a note over the limit, saying what the limit is', () => {
    const result = UpdatePublishNoteSchema.safeParse({
      ...base,
      note: 'x'.repeat(5001),
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('At most 5,000 characters');
  });

  it('requires the time the editor read, null for a note never written', () => {
    expect(
      UpdatePublishNoteSchema.safeParse({ publishId: PUBLISH, note: 'x' })
        .success,
    ).toBe(false);
  });
});
