import { describe, expect, it } from 'vitest';

import {
  dailyCapOf,
  episodeFullState,
  postsInLastDay,
} from '../src/lib/cadence/dispatch';
import {
  type GatedPublish,
  cadenceGate,
  longVideoStates,
} from '../src/lib/cadence/gate';

/**
 * FILM-719. What the scheduled job does with a due post: a Short waits for
 * its episode's long video, and a cadence post waits for a day its channel
 * has room.
 */
const NOW = new Date('2026-11-05T12:30:00Z');

interface Call {
  table: string;
  op: 'select' | 'update';
  filters: Record<string, unknown>;
  values?: Record<string, unknown>;
}

/** A client whose reads answer from `tables`; updates are recorded */
function fakeClient(options: {
  fullStatuses?: Array<{ episode_id: string; status: string }>;
  recent?: Array<{ status: string; published_at: string | null }>;
  cadence?: { slot_times: string[]; enabled: boolean } | null;
  /** Update attempts that fail on the slot index, in order */
  slotTaken?: number;
}) {
  const calls: Call[] = [];
  let slotTaken = options.slotTaken ?? 0;

  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: {} };
    calls.push(call);

    const answer = () => {
      if (call.op === 'update') {
        if (call.values && 'slot_at' in call.values && slotTaken > 0) {
          slotTaken--;
          return { data: null, error: { code: '23505', message: 'taken' } };
        }
        return { data: [{ id: call.filters.id }], error: null };
      }
      if (table === 'channel_posting_cadences') {
        return { data: options.cadence ?? null, error: null };
      }
      if ('episode_id' in call.filters) {
        return { data: options.fullStatuses ?? [], error: null };
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

const short = (overrides: Partial<GatedPublish> = {}): GatedPublish => ({
  id: 'short-1',
  episode_id: 'ep1',
  platform_connection_id: 'yt',
  content_type: 'short',
  metadata: { shortsGroupId: 'g1' },
  scheduled_at: '2026-11-05T12:41:00Z',
  slot_at: '2026-11-05T12:30:00Z',
  after_episode_full: true,
  ...overrides,
});

describe('a Short that waits for its episode’s long video', () => {
  it('goes once the long video is live', async () => {
    const { client } = fakeClient({
      fullStatuses: [
        { episode_id: 'ep1', status: 'failed' },
        { episode_id: 'ep1', status: 'published' },
      ],
    });
    const states = await longVideoStates(client, [short()]);

    expect(await cadenceGate(client, short(), states, NOW)).toBe('go');
  });

  it('waits while the long video is on its way, writing nothing', async () => {
    const { client, calls } = fakeClient({
      fullStatuses: [{ episode_id: 'ep1', status: 'queued' }],
    });
    const states = await longVideoStates(client, [short()]);

    expect(await cadenceGate(client, short(), states, NOW)).toBe('waiting');
    expect(calls.filter((c) => c.op === 'update')).toEqual([]);
  });

  it('fails, saying why, when the long video will never go out', async () => {
    const { client, calls } = fakeClient({
      fullStatuses: [{ episode_id: 'ep1', status: 'failed' }],
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

describe('a cadence post on a channel that has had its day', () => {
  const publishedToday = {
    status: 'published',
    published_at: '2026-11-05T06:00:00Z',
  };

  it('moves a day on, keeping its time of day', async () => {
    const { client, calls } = fakeClient({ recent: [publishedToday] });
    const post = short({ after_episode_full: false });

    expect(await cadenceGate(client, post, new Map(), NOW)).toBe('deferred');

    const [move] = calls.filter((c) => c.op === 'update');
    expect(move!.values).toEqual({
      slot_at: '2026-11-06T12:30:00.000Z',
      scheduled_at: '2026-11-06T12:41:00.000Z',
    });
    expect(move!.filters).toEqual({ id: 'short-1', status: 'scheduled' });
  });

  it('skips a day whose slot another post holds', async () => {
    const { client, calls } = fakeClient({
      recent: [publishedToday],
      slotTaken: 2,
    });
    const post = short({ after_episode_full: false });

    expect(await cadenceGate(client, post, new Map(), NOW)).toBe('deferred');

    const moves = calls.filter((c) => c.op === 'update');
    expect(moves.map((m) => m.values!.slot_at)).toEqual([
      '2026-11-06T12:30:00.000Z',
      '2026-11-07T12:30:00.000Z',
      '2026-11-08T12:30:00.000Z',
    ]);
  });

  it('goes when the channel takes two a day and has had one', async () => {
    const { client } = fakeClient({
      recent: [publishedToday],
      cadence: { slot_times: ['10:00', '18:00'], enabled: true },
    });
    const post = short({ after_episode_full: false });

    expect(await cadenceGate(client, post, new Map(), NOW)).toBe('go');
  });

  it('counts a post the run just claimed', async () => {
    const { client } = fakeClient({
      recent: [{ status: 'queued', published_at: null }],
    });
    const post = short({ after_episode_full: false });

    expect(await cadenceGate(client, post, new Map(), NOW)).toBe('deferred');
  });

  it('never moves a post scheduled by hand', async () => {
    const { client, calls } = fakeClient({ recent: [publishedToday] });
    const byHand = short({ after_episode_full: false, slot_at: null });

    expect(await cadenceGate(client, byHand, new Map(), NOW)).toBe('go');
    expect(calls.filter((c) => c.op === 'update')).toEqual([]);
  });
});

describe('the rules, read alone', () => {
  it('reads a long video’s state from its publishes', () => {
    expect(episodeFullState(['failed', 'unlisted'])).toBe('live');
    expect(episodeFullState(['failed', 'scheduled'])).toBe('waiting');
    expect(episodeFullState(['failed', 'deleted'])).toBe('gone');
    expect(episodeFullState([])).toBe('gone');
  });

  it('counts only the last day’s posts', () => {
    expect(
      postsInLastDay(
        [
          { status: 'published', published_at: '2026-11-04T12:00:00Z' },
          { status: 'published', published_at: '2026-11-05T01:00:00Z' },
          { status: 'publishing', published_at: null },
          { status: 'failed', published_at: null },
        ],
        NOW,
      ),
    ).toBe(2);
  });

  it('caps a channel with no cadence at one a day', () => {
    expect(dailyCapOf(null)).toBe(1);
    expect(dailyCapOf({ slot_times: ['09:00', '18:00'], enabled: false })).toBe(
      1,
    );
    expect(dailyCapOf({ slot_times: ['09:00', '18:00'], enabled: true })).toBe(
      2,
    );
  });
});
