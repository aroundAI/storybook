import { describe, expect, it, vi } from 'vitest';

import {
  type ChannelCadence,
  DEFAULT_CADENCE,
} from '../src/lib/cadence/cadence';
import {
  type CadenceCandidate,
  type CalendarPost,
  cadenceConflicts,
} from '../src/lib/cadence/cadence-guard';

/**
 * KB-204. Publish All posted 9 YouTube Shorts, 7 Facebook Reels and 7
 * Instagram Reels in nine minutes on 2026-10-19, and MCP schedule_publish
 * put three long videos 30 minutes apart: a post whose time the caller
 * chose skipped the channels' posting rules. The guard holds such a post to
 * them: no more Shorts on a channel-local day than the channel's Short
 * times, no long video closer than `minDaysBetween` to another.
 */

vi.mock('server-only', () => ({}));

const TZ = 'Asia/Kolkata';
const YT = '00000000-0000-4000-8000-0000000000c1';
const IG = '00000000-0000-4000-8000-0000000000c2';

function cadence(
  contentType: 'full' | 'short',
  overrides: Partial<ChannelCadence> = {},
): ChannelCadence {
  return { ...DEFAULT_CADENCE[contentType], timezone: TZ, ...overrides };
}

const short = (at: string, connectionId = YT): CalendarPost => ({
  connectionId,
  contentType: 'short',
  goesAt: new Date(at),
});
const long = (at: string, connectionId = YT): CalendarPost => ({
  connectionId,
  contentType: 'full',
  goesAt: new Date(at),
});
const candidate = (
  contentType: 'full' | 'short',
  at: string,
  connectionId = YT,
  key = `${contentType}-${at}-${connectionId}`,
): CadenceCandidate => ({ key, connectionId, contentType, at: new Date(at) });

function conflicts(
  candidates: CadenceCandidate[],
  posts: CalendarPost[],
  rules: Partial<Record<'full' | 'short', Partial<ChannelCadence>>> = {},
) {
  return cadenceConflicts({
    candidates,
    posts,
    cadenceOf: (_id, type) => cadence(type, rules[type]),
  });
}

describe('a Short at a chosen time (KB-204)', () => {
  it('is refused on a channel-local day that already has its Shorts', () => {
    // 07:30 IST: one Short already out today, and the channel posts one
    const result = conflicts(
      [candidate('short', '2026-10-19T10:00:00Z')],
      [short('2026-10-19T02:00:00Z')],
    );

    expect(result).toEqual([
      expect.objectContaining({
        rule: 'shorts-per-day',
        day: '2026-10-19',
        posted: 1,
        cap: 1,
      }),
    ]);
  });

  it('goes on the next local day, and on another channel the same day', () => {
    expect(
      conflicts(
        [
          // 00:30 IST on the 20th: a new local day, though 2026-10-19 in UTC
          candidate('short', '2026-10-19T19:00:00Z'),
          candidate('short', '2026-10-19T10:00:00Z', IG),
        ],
        [short('2026-10-19T02:00:00Z')],
      ),
    ).toEqual([]);
  });

  it('counts the Shorts of one request against each other', () => {
    // The incident: every Short of the episode, on one channel, at once
    const result = conflicts(
      [
        candidate('short', '2026-10-19T10:00:00Z', YT, 'a'),
        candidate('short', '2026-10-19T10:01:00Z', YT, 'b'),
        candidate('short', '2026-10-19T10:02:00Z', YT, 'c'),
      ],
      [],
      { short: { slotTimes: ['12:00', '18:00'] } },
    );

    expect(result.map((c) => c.key)).toEqual(['c']);
  });

  it('counts a scheduled Short on that day too', () => {
    expect(
      conflicts(
        [candidate('short', '2026-10-19T05:00:00Z')],
        [short('2026-10-19T12:30:00Z')],
      ),
    ).toHaveLength(1);
  });
});

describe('a long video at a chosen time (KB-204)', () => {
  it('is refused closer than minDaysBetween to another, before or after it', () => {
    // MCP put three long videos 30 minutes apart
    const result = conflicts(
      [
        candidate('full', '2026-10-19T12:00:00Z', YT, 'first'),
        candidate('full', '2026-10-19T12:30:00Z', YT, 'second'),
        candidate('full', '2026-10-19T13:00:00Z', YT, 'third'),
      ],
      [],
    );

    expect(result.map((c) => c.key)).toEqual(['second', 'third']);
    expect(result[0]).toMatchObject({
      rule: 'long-spacing',
      nearestDay: '2026-10-19',
      minDaysBetween: 3,
    });

    expect(
      conflicts(
        [candidate('full', '2026-10-19T12:00:00Z')],
        [long('2026-10-21T12:00:00Z')],
      ),
    ).toHaveLength(1);
  });

  it('goes minDaysBetween local days after the last', () => {
    expect(
      conflicts(
        [candidate('full', '2026-10-22T03:00:00Z')],
        [long('2026-10-19T12:00:00Z')],
      ),
    ).toEqual([]);
  });

  it('is never refused on a channel that keeps no days between long videos', () => {
    expect(
      conflicts(
        [candidate('full', '2026-10-19T12:30:00Z')],
        [long('2026-10-19T12:00:00Z')],
        { full: { minDaysBetween: 0 } },
      ),
    ).toEqual([]);
  });

  it('is not held to the Shorts, nor a Short to the long videos', () => {
    expect(
      conflicts(
        [
          candidate('full', '2026-10-19T12:00:00Z'),
          candidate('short', '2026-10-19T14:00:00Z'),
        ],
        [short('2026-10-18T12:00:00Z'), long('2026-10-15T12:00:00Z')],
      ),
    ).toEqual([]);
  });
});

describe('cadenceRefusal reads the channel as the planner does (KB-204)', () => {
  const NOW = new Date('2026-10-19T10:00:00Z');

  function fakeClient(tables: Record<string, Array<Record<string, unknown>>>) {
    return {
      from(table: string) {
        const filters: Array<(row: Record<string, unknown>) => boolean> = [];
        let range: [number, number] | null = null;
        const q = {
          select: () => q,
          eq: (column: string, value: unknown) => {
            filters.push((row) => row[column] === value);
            return q;
          },
          in: (column: string, list: unknown[]) => {
            filters.push((row) => list.includes(row[column]));
            return q;
          },
          gte: (column: string, value: string) => {
            filters.push(
              (row) => !!row[column] && String(row[column]) >= value,
            );
            return q;
          },
          order: () => q,
          range: (from: number, to: number) => {
            range = [from, to];
            return q;
          },
          then: (resolve: (value: unknown) => unknown) => {
            const rows = (tables[table] ?? []).filter((row) =>
              filters.every((f) => f(row)),
            );
            return resolve({
              data: range ? rows.slice(range[0], range[1] + 1) : rows,
              error: null,
            });
          },
        };
        return q;
      },
    } as never;
  }

  const publish = (overrides: Record<string, unknown>) => ({
    id: `pub-${Math.random()}`,
    episode_id: 'e1',
    platform_connection_id: YT,
    content_type: 'short',
    status: 'published',
    slot_at: null,
    scheduled_at: null,
    published_at: null,
    release_priority: 'normal',
    ...overrides,
  });

  it('refuses a second Short today and names the channel and the way out', async () => {
    const { cadenceRefusal } = await import(
      '../src/server/cadence-guard.service'
    );
    const client = fakeClient({
      publishes: [publish({ published_at: '2026-10-19T09:51:00Z' })],
      channel_posting_cadences: [],
      platform_connections: [{ id: YT, platform_account_name: 'Story YT' }],
    });

    const refusal = await cadenceRefusal(
      client,
      [{ connectionId: YT, contentType: 'short', at: NOW }],
      { timezone: TZ, now: NOW, hint: 'Schedule the release instead.' },
    );

    expect(refusal).toBe(
      'Story YT already has 1 Short on 2026-10-19, and its posting rules allow 1 a day. Schedule the release instead.',
    );
  });

  it('allows what the channel’s own posting rules allow', async () => {
    const { cadenceRefusal } = await import(
      '../src/server/cadence-guard.service'
    );
    const client = fakeClient({
      publishes: [
        publish({ published_at: '2026-10-19T09:51:00Z' }),
        // Failed: never went out, so it holds nothing
        publish({ status: 'failed', published_at: null }),
      ],
      channel_posting_cadences: [
        {
          platform_connection_id: YT,
          content_type: 'short',
          timezone: TZ,
          slot_times: ['12:00', '18:00'],
          days_of_week: [0, 1, 2, 3, 4, 5, 6],
          min_days_between: 0,
          every_n_days: 1,
          start_after_hours: 2,
          jitter_minutes: 20,
          enabled: true,
        },
      ],
      platform_connections: [{ id: YT, platform_account_name: 'Story YT' }],
    });

    expect(
      await cadenceRefusal(
        client,
        [{ connectionId: YT, contentType: 'short', at: NOW }],
        { timezone: TZ, now: NOW, hint: '' },
      ),
    ).toBeNull();
  });
});
