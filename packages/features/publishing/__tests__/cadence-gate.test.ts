import { describe, expect, it } from 'vitest';

import type { ChannelCadenceRow } from '../src/lib/cadence/cadence';
import {
  episodeFullState,
  gateCadence,
  postsToday,
} from '../src/lib/cadence/dispatch';
import {
  type GatedPublish,
  cadenceGate,
  longVideoStates,
} from '../src/lib/cadence/gate';

/**
 * FILM-719, FILM-2209. What the scheduled job does with a due post: a Short
 * waits for its episode's long video on its own channel, and a cadence post
 * waits for a local day its channel has room, moving the queue behind it
 * on in order.
 */
const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-11-05T12:30:00Z'); // 18:00 IST, Thursday

interface Call {
  table: string;
  op: 'select' | 'update';
  filters: Record<string, unknown>;
  values?: Record<string, unknown>;
}

interface CalendarRow {
  id: string;
  content_type: string;
  status: string;
  slot_at: string | null;
  scheduled_at: string | null;
}

/** A client whose reads answer from `options`; updates are recorded */
function fakeClient(options: {
  fullStatuses?: Array<{
    episode_id: string;
    platform_connection_id: string;
    status: string;
  }>;
  recent?: Array<{ status: string; published_at: string | null }>;
  cadence?: Partial<ChannelCadenceRow> | null;
  calendar?: CalendarRow[];
  /** Ids whose move fails on the slot index */
  slotTaken?: string[];
}) {
  const calls: Call[] = [];

  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: {} };
    calls.push(call);

    const answer = () => {
      if (call.op === 'update') {
        if (options.slotTaken?.includes(String(call.filters.id))) {
          return { data: null, error: { code: '23505', message: 'taken' } };
        }
        return { data: null, error: null };
      }
      if (table === 'channel_posting_cadences') {
        return {
          data: options.cadence ? { ...ROW, ...options.cadence } : null,
          error: null,
        };
      }
      if ('episode_id' in call.filters) {
        return { data: options.fullStatuses ?? [], error: null };
      }
      if (String(call.filters.or).includes('slot_at.gte')) {
        const rows = options.calendar ?? [];
        const [start, end] = (call.filters.range as [number, number]) ?? [
          0,
          rows.length,
        ];
        return { data: rows.slice(start, end + 1), error: null };
      }
      return { data: options.recent ?? [], error: null };
    };

    const q = {
      select: () => q,
      update: (values: Record<string, unknown>) => {
        call.op = 'update';
        call.values = values;
        return q;
      },
      eq: (column: string, value: unknown) => {
        call.filters[column] = value;
        return q;
      },
      neq: (column: string, value: unknown) => {
        call.filters[`not ${column}`] = value;
        return q;
      },
      in: (column: string, value: unknown) => {
        call.filters[column] = value;
        return q;
      },
      or: (value: string) => {
        call.filters.or = value;
        return q;
      },
      order: () => q,
      range: (start: number, end: number) => {
        call.filters.range = [start, end];
        return q;
      },
      maybeSingle: () => Promise.resolve(answer()),
      then: (resolve: (value: unknown) => unknown) => resolve(answer()),
    };

    return q;
  };

  return {
    client: { from } as unknown as Parameters<typeof cadenceGate>[0],
    calls,
  };
}

/** Two Shorts a day at 11:00 and 17:00 IST */
const ROW: ChannelCadenceRow = {
  platform_connection_id: 'yt',
  content_type: 'short',
  timezone: TZ,
  slot_times: ['11:00', '17:00'],
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  min_days_between: 0,
  every_n_days: 1,
  start_after_hours: 2,
  jitter_minutes: 15,
  enabled: true,
};

const short = (overrides: Partial<GatedPublish> = {}): GatedPublish => ({
  id: 'short-1',
  episode_id: 'ep1',
  platform_connection_id: 'yt',
  content_type: 'short',
  metadata: { shortsGroupId: 'g1' },
  scheduled_at: '2026-11-05T11:41:00Z',
  slot_at: '2026-11-05T11:30:00Z', // 17:00 IST
  after_episode_full: true,
  ...overrides,
});

const moves = (calls: Call[]) =>
  calls
    .filter((c) => c.op === 'update')
    .map((c) => ({ id: c.filters.id, ...c.values }) as Record<string, unknown>);

describe('a Short that waits for its episode’s long video', () => {
  it('goes once the long video on its channel is live', async () => {
    const { client } = fakeClient({
      fullStatuses: [
        { episode_id: 'ep1', platform_connection_id: 'yt', status: 'failed' },
        {
          episode_id: 'ep1',
          platform_connection_id: 'yt',
          status: 'published',
        },
      ],
    });
    const states = await longVideoStates(client, [short()]);

    expect(await cadenceGate(client, short(), states, NOW)).toBe('go');
  });

  it('waits for the long video on its own channel, though another channel’s is live', async () => {
    const { client, calls } = fakeClient({
      fullStatuses: [
        {
          episode_id: 'ep1',
          platform_connection_id: 'fb',
          status: 'published',
        },
        {
          episode_id: 'ep1',
          platform_connection_id: 'yt',
          status: 'scheduled',
        },
      ],
    });
    const states = await longVideoStates(client, [short()]);

    expect(await cadenceGate(client, short(), states, NOW)).toBe('waiting');
    expect(calls.filter((c) => c.op === 'update')).toEqual([]);
  });

  it('follows any long video on a channel with none of its own', async () => {
    const { client } = fakeClient({
      fullStatuses: [
        {
          episode_id: 'ep1',
          platform_connection_id: 'yt',
          status: 'published',
        },
      ],
    });
    const reel = short({ id: 'reel-1', platform_connection_id: 'ig' });
    const states = await longVideoStates(client, [reel]);

    expect(states.get('reel-1')).toBe('live');
  });

  it('fails, saying why, when the long video will never go out', async () => {
    const { client, calls } = fakeClient({
      fullStatuses: [
        { episode_id: 'ep1', platform_connection_id: 'yt', status: 'failed' },
      ],
    });
    const states = await longVideoStates(client, [short()]);

    expect(await cadenceGate(client, short(), states, NOW)).toBe('failed');

    const [update] = calls.filter((c) => c.op === 'update');
    expect(update!.values!.status).toBe('failed');
    expect(update!.filters).toEqual({ id: 'short-1', status: 'scheduled' });
    expect(
      (update!.values!.metadata as { error: string; shortsGroupId: string })
        .error,
    ).toMatch(/long video, which did not go out/);
  });

  it('does not wait when the Short was scheduled without a long video', async () => {
    const { client } = fakeClient({});
    const alone = short({ after_episode_full: false, slot_at: null });

    expect(await cadenceGate(client, alone, new Map(), NOW)).toBe('go');
  });
});

describe('a cadence post on a channel that has had its local day', () => {
  const publishedToday = (hhmm: string) => ({
    status: 'published',
    published_at: new Date(`2026-11-05T${hhmm}:00+05:30`).toISOString(),
  });
  const ist = (iso: string) =>
    new Date(iso).toLocaleString('en-CA', { timeZone: TZ, hour12: false });

  it('moves it and the Shorts queued after it on a slot each, in order, from tomorrow', async () => {
    const queued = (id: string, when: string, type = 'short') => ({
      id,
      content_type: type,
      status: 'scheduled',
      slot_at: new Date(`${when}+05:30`).toISOString(),
      scheduled_at: new Date(`${when}+05:30`).toISOString(),
    });
    const { client, calls } = fakeClient({
      cadence: ROW,
      recent: [publishedToday('11:04'), publishedToday('11:20')],
      calendar: [
        queued('q1', '2026-11-06T11:00:00'),
        queued('q2', '2026-11-06T17:00:00'),
        queued('q3', '2026-11-07T11:00:00'),
        // A long video holds 17:00 on the 7th
        queued('long', '2026-11-07T17:00:00', 'full'),
      ],
    });
    const post = short({ after_episode_full: false });

    expect(await cadenceGate(client, post, new Map(), NOW)).toBe('deferred');

    // Last first, so each slot is free when it is taken
    expect(moves(calls).map((m) => [m.id, ist(m.slot_at as string)])).toEqual([
      ['q3', '2026-11-08, 11:00:00'],
      ['q2', '2026-11-07, 11:00:00'],
      ['q1', '2026-11-06, 17:00:00'],
      ['short-1', '2026-11-06, 11:00:00'],
    ]);

    // Each keeps its jitter
    const own = moves(calls).find((m) => m.id === 'short-1')!;
    expect(
      new Date(own.scheduled_at as string).getTime() -
        new Date(own.slot_at as string).getTime(),
    ).toBe(11 * 60_000);
  });

  it('leaves the rest for the next run when a slot was taken meanwhile', async () => {
    const { client, calls } = fakeClient({
      cadence: ROW,
      recent: [publishedToday('11:04'), publishedToday('11:20')],
      slotTaken: ['short-1'],
    });
    const post = short({ after_episode_full: false });

    expect(await cadenceGate(client, post, new Map(), NOW)).toBe('deferred');
    expect(moves(calls)).toHaveLength(1);
  });

  it('goes when the channel takes two a day and has had one', async () => {
    const { client, calls } = fakeClient({
      cadence: ROW,
      recent: [publishedToday('11:04')],
    });
    const post = short({ after_episode_full: false });

    expect(await cadenceGate(client, post, new Map(), NOW)).toBe('go');
    expect(moves(calls)).toEqual([]);
  });

  it('counts the local day, not the last 24 hours', async () => {
    // 11:05 IST; yesterday's 17:30 Short is within 24 hours, not today
    const morning = new Date('2026-11-05T05:35:00Z');
    const { client } = fakeClient({
      cadence: { ...ROW, slot_times: ['11:00'] },
      recent: [
        {
          status: 'published',
          published_at: new Date('2026-11-04T17:30:00+05:30').toISOString(),
        },
      ],
    });
    const post = short({
      after_episode_full: false,
      slot_at: '2026-11-05T05:30:00Z',
      scheduled_at: '2026-11-05T05:33:00Z',
    });

    expect(await cadenceGate(client, post, new Map(), morning)).toBe('go');
  });

  it('counts a post the run just claimed', async () => {
    const { client } = fakeClient({
      recent: [{ status: 'queued', published_at: null }],
    });
    const post = short({ after_episode_full: false });

    expect(await cadenceGate(client, post, new Map(), NOW)).toBe('deferred');
  });

  it('moves a post on a channel with no posting rules to the same time the next day', async () => {
    const { client, calls } = fakeClient({ recent: [publishedToday('09:00')] });
    const post = short({ after_episode_full: false });

    expect(await cadenceGate(client, post, new Map(), NOW)).toBe('deferred');
    expect(moves(calls)).toEqual([
      {
        id: 'short-1',
        slot_at: '2026-11-06T11:30:00.000Z',
        scheduled_at: '2026-11-06T11:41:00.000Z',
      },
    ]);
  });

  it('never moves a post scheduled by hand', async () => {
    const { client, calls } = fakeClient({
      recent: [publishedToday('09:00')],
    });
    const byHand = short({ after_episode_full: false, slot_at: null });

    expect(await cadenceGate(client, byHand, new Map(), NOW)).toBe('go');
    expect(moves(calls)).toEqual([]);
  });
});

describe('the rules, read alone', () => {
  it('reads a long video’s state from its publishes', () => {
    expect(episodeFullState(['failed', 'unlisted'])).toBe('live');
    expect(episodeFullState(['failed', 'scheduled'])).toBe('waiting');
    expect(episodeFullState(['failed', 'deleted'])).toBe('gone');
    expect(episodeFullState([])).toBe('gone');
  });

  it('counts only the local day’s posts', () => {
    expect(
      postsToday(
        [
          { status: 'published', published_at: '2026-11-04T18:00:00Z' }, // 23:30 IST yesterday
          { status: 'published', published_at: '2026-11-04T19:00:00Z' }, // 00:30 IST today
          { status: 'publishing', published_at: null },
          { status: 'failed', published_at: null },
        ],
        NOW,
        TZ,
      ),
    ).toBe(2);
  });

  it('holds a channel with no rules to one a day, at the post’s own time', () => {
    const slot = new Date('2026-11-05T11:30:00Z');

    expect(gateCadence(null, 'short', slot)).toMatchObject({
      timezone: 'UTC',
      slotTimes: ['11:30'],
    });
    expect(
      gateCadence({ ...ROW, enabled: false }, 'short', slot).slotTimes,
    ).toEqual(['11:30']);
    expect(gateCadence(ROW, 'short', slot).slotTimes).toEqual([
      '11:00',
      '17:00',
    ]);
  });
});
