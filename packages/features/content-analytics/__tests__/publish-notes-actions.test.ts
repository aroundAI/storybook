import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdatePublishNoteSchema } from '../src/lib/schemas/publish-note.schema';
import { updatePublishNoteAction } from '../src/server/publish-notes-actions';

const PUBLISH = '0b6f5a4e-3c1d-4e2f-9a8b-7c6d5e4f3a2b';

const state: {
  /** Rows the update matched; empty is what an RLS refusal looks like. */
  matched: Array<{
    id: string;
    analytics_note: string | null;
    analytics_note_updated_at: string;
  }>;
  written: Record<string, unknown> | null;
} = { matched: [], written: null };

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

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        state.written = payload;
        return {
          eq: () => ({
            select: async () => ({ data: state.matched, error: null }),
          }),
        };
      },
    }),
  }),
}));

beforeEach(() => {
  state.matched = [];
  state.written = null;
});

describe('updatePublishNoteAction', () => {
  it('writes the note with its author and time in one update', async () => {
    state.matched = [
      {
        id: PUBLISH,
        analytics_note: 'Swapped thumbnail',
        analytics_note_updated_at: 't',
      },
    ];

    const result = await updatePublishNoteAction({
      publishId: PUBLISH,
      note: 'Swapped thumbnail',
    });

    expect(state.written).toMatchObject({
      analytics_note: 'Swapped thumbnail',
      analytics_note_updated_by: 'u1',
    });
    expect(state.written).toHaveProperty('analytics_note_updated_at');
    expect(state.written).not.toHaveProperty('metadata');
    expect(result).toEqual({
      publishId: PUBLISH,
      note: 'Swapped thumbnail',
      updatedAt: 't',
    });
  });

  it('reports a refused write as a failure, not a save', async () => {
    // RLS refusing an update matches zero rows and returns 200 with no error.
    state.matched = [];

    await expect(
      updatePublishNoteAction({ publishId: PUBLISH, note: 'Hello' }),
    ).rejects.toThrow('You cannot edit notes on this video');
  });
});

describe('UpdatePublishNoteSchema', () => {
  it('stores a blank or whitespace note as no note', () => {
    expect(
      UpdatePublishNoteSchema.parse({ publishId: PUBLISH, note: '   ' }).note,
    ).toBeNull();
    expect(
      UpdatePublishNoteSchema.parse({ publishId: PUBLISH, note: '' }).note,
    ).toBeNull();
  });

  it('keeps a real note exactly as written', () => {
    expect(
      UpdatePublishNoteSchema.parse({
        publishId: PUBLISH,
        note: '  Day 3: new hook ',
      }).note,
    ).toBe('  Day 3: new hook ');
  });

  it('refuses a note over the limit', () => {
    expect(() =>
      UpdatePublishNoteSchema.parse({
        publishId: PUBLISH,
        note: 'x'.repeat(5001),
      }),
    ).toThrow();
  });
});
