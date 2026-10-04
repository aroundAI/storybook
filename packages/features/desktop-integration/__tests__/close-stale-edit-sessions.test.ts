import { describe, expect, it } from 'vitest';

import { closeStaleEditSessions } from '../src/server/edit-sessions';

/**
 * FILM-2002 AC6: the hourly cron closes every open session idle for 24
 * hours, as 'stale', with the summary of its events. A recording client
 * stands in for the admin client.
 */
type Filter = { method: string; args: unknown[] };

function fakeAdmin(options: {
  stale: string[];
  close: (sessionId: string) => unknown;
}) {
  const filters: Filter[] = [];
  const closes: Array<Record<string, unknown>> = [];

  const query = (table: string) => {
    const own: Filter[] = [];
    const chain: Record<string, unknown> = {};

    for (const method of ['select', 'eq', 'lt', 'order', 'limit', 'range']) {
      chain[method] = (...args: unknown[]) => {
        own.push({ method, args });
        if (table === 'edit_sessions') filters.push({ method, args });

        return chain;
      };
    }

    chain.maybeSingle = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => {
      const id = own.find((f) => f.method === 'eq' && f.args[0] === 'id')
        ?.args[1];

      if (table === 'edit_events') {
        const range = own.find((f) => f.method === 'range');

        return Promise.resolve(
          resolve({
            data:
              range?.args[0] === 0
                ? [
                    {
                      id: 1,
                      ts: '2026-10-03T00:00:00Z',
                      type: 'qa_run',
                      data: {},
                    },
                  ]
                : [],
            error: null,
          }),
        );
      }

      if (id) {
        return Promise.resolve(
          resolve({ data: { id, status: 'open' }, error: null }),
        );
      }

      return Promise.resolve(
        resolve({ data: options.stale.map((s) => ({ id: s })), error: null }),
      );
    };

    return chain;
  };

  const rpc = (name: string, args: Record<string, unknown>) => {
    closes.push({ name, ...args });

    return Promise.resolve({
      data: options.close(args.p_session_id as string),
      error: null,
    });
  };

  return { client: { from: query, rpc } as never, filters, closes };
}

describe('closeStaleEditSessions', () => {
  it('closes each open session idle past 24 hours as stale, with its summary', async () => {
    const admin = fakeAdmin({
      stale: ['s1', 's2'],
      close: () => ({
        ok: true,
        session: {},
        restoredStatus: 'ready',
        episodeStatus: 'ready',
        episodeVersion: 2,
      }),
    });

    const result = await closeStaleEditSessions(admin.client, {
      now: new Date('2026-10-04T12:00:00Z'),
    });

    expect(admin.filters).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['status', 'open'] },
        { method: 'lt', args: ['last_event_at', '2026-10-03T12:00:00.000Z'] },
      ]),
    );
    expect(admin.closes.map((c) => [c.p_session_id, c.p_reason])).toEqual([
      ['s1', 'stale'],
      ['s2', 'stale'],
    ]);
    expect(admin.closes[0]?.p_summary).toMatchObject({ qaRuns: 1 });
    expect(result).toEqual({ closed: 2, failed: 0, ids: ['s1', 's2'] });
  });

  it('counts a session another caller closed first as neither closed nor failed', async () => {
    const admin = fakeAdmin({
      stale: ['s1', 's2'],
      close: (id) =>
        id === 's1'
          ? { ok: false, code: 'VALIDATION_FAILED', status: 'closed' }
          : { ok: false, code: 'NOT_FOUND' },
    });

    expect(await closeStaleEditSessions(admin.client)).toEqual({
      closed: 0,
      failed: 1,
      ids: [],
    });
  });
});
