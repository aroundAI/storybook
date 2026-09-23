// @vitest-environment node
/**
 * How a failed read reaches `render_error` (KB-32). The worker used to turn
 * every step-1 error into "Edit project not found", which is how a 42703 —
 * a query naming columns that do not exist — hid for months as a missing row.
 *
 * A fake client can only check branching, not SQL; the column lists are
 * checked by the typed client (`pnpm typecheck`) and against a real
 * database by render-evidence.test.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { describe, expect, it } from 'vitest';

import type { Database } from '@kit/supabase/database';

import { RenderStageError, loadRenderInput } from '../render-input';

type Result = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

/** A chainable stand-in whose result depends on the table and the page. */
function fakeClient(respond: (table: string, from: number) => Result) {
  return {
    from(table: string) {
      let from = 0;
      const builder = {
        update: () => builder,
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        range: (start: number) => {
          from = start;
          return builder;
        },
        maybeSingle: () => builder,
        then: (
          resolve: (r: Result) => unknown,
          reject: (e: unknown) => unknown,
        ) => Promise.resolve(respond(table, from)).then(resolve, reject),
      };
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
}

const project = { id: 'p', episode_id: 'e', width: 1280, height: 720, fps: 30 };

async function failure(respond: (table: string, from: number) => Result) {
  try {
    await loadRenderInput(fakeClient(respond), 'p');
  } catch (error) {
    return error;
  }

  throw new Error('loadRenderInput resolved');
}

describe('loadRenderInput errors (KB-32)', () => {
  it('reports a query error on the project as a load failure with its code, not "not found"', async () => {
    const error = await failure(() => ({
      data: null,
      error: {
        code: '42703',
        message: 'column edit_projects.canvas_height does not exist',
      },
    }));

    expect(error).toBeInstanceOf(RenderStageError);
    expect((error as Error).message).toBe(
      'Could not load the edit project (42703)',
    );
    expect((error as RenderStageError).detail?.message).toContain(
      'canvas_height',
    );
  });

  it('reports "Edit project not found" only when no row matched', async () => {
    const error = await failure(() => ({ data: null, error: null }));

    expect((error as Error).message).toBe('Edit project not found');
  });

  it('fails the render when the clip read fails, instead of rendering without clips', async () => {
    const error = await failure((table, from) => {
      if (table === 'edit_projects') return { data: project, error: null };
      if (table === 'edit_tracks')
        return { data: from === 0 ? [{ id: 't' }] : [], error: null };
      return {
        data: null,
        error: { code: '42703', message: 'column edit_clips.x does not exist' },
      };
    });

    expect((error as Error).message).toBe('Could not load the timeline');
    expect((error as RenderStageError).detail?.message).toContain(
      'edit_clips.x',
    );
  });

  it('returns every page of clips', async () => {
    const page = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

    const rows = await loadRenderInput(
      fakeClient((table, from) => {
        if (table === 'edit_projects') return { data: project, error: null };
        if (table === 'edit_tracks')
          return { data: from === 0 ? [{ id: 't' }] : [], error: null };
        // two full pages and a partial one: a single unpaged read would stop at the first
        return {
          data:
            from === 0
              ? page(500, 'a')
              : from === 500
                ? page(500, 'b')
                : from === 1000
                  ? page(1, 'c')
                  : [],
          error: null,
        };
      }),
      'p',
    );

    expect(rows.clips).toHaveLength(1001);
  });
});
