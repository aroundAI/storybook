import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { describe, expect, it } from 'vitest';

import {
  type ChannelCadence,
  DEFAULT_CADENCE,
} from '../src/lib/cadence/cadence';
import type { OccupiedPost } from '../src/lib/cadence/plan-release';
import { planReplan } from '../src/lib/cadence/plan-replan';

/**
 * FILM-2213. New posting rules re-plan what is already scheduled (owner,
 * 2026-10-22). The shape is the owner's: Episodes 2–4 bulk-scheduled on
 * the old rules, a long video every 3 days at 22:15 IST (one of them on a
 * Wednesday) and 3 Shorts a day, then rules of long videos Thu–Mon at
 * 16:00 New York time and Shorts at 13:00, 17:00, 20:30 and 23:00.
 */

const IST = 'Asia/Kolkata';
const ET = 'America/New_York';
const YT = 'yt';
const NOW = new Date('2026-10-22T12:00:00Z'); // Thursday, 08:00 in New York

const OLD_SHORT_TIMES = ['11:00', '15:00', '19:00'];

const NEW_RULES: Record<'full' | 'short', ChannelCadence> = {
  full: {
    ...DEFAULT_CADENCE.full,
    timezone: ET,
    slotTimes: ['16:00'],
    daysOfWeek: [4, 5, 6, 0, 1],
    minDaysBetween: 3,
    jitterMinutes: 0,
  },
  short: {
    ...DEFAULT_CADENCE.short,
    timezone: ET,
    slotTimes: ['13:00', '17:00', '20:30', '23:00'],
    startAfterHours: 1,
    jitterMinutes: 0,
  },
};

const at = (day: string, time: string, zone: string) =>
  fromZonedTime(`${day}T${time}:00`, zone);

function post(
  id: string,
  episodeId: string,
  contentType: 'full' | 'short',
  when: Date,
  extra: Partial<OccupiedPost> = {},
): OccupiedPost {
  return {
    publishId: id,
    connectionId: YT,
    episodeId,
    contentType,
    status: 'scheduled',
    at: when,
    goesAt: when,
    slotted: true,
    ...extra,
  };
}

/** Ep 2–4 as the old rules laid them: Sun, Wed, Sat at 22:15 IST */
function bulkScheduled() {
  const longs: Array<[string, string]> = [
    ['ep2', '2026-10-25'],
    ['ep3', '2026-10-28'],
    ['ep4', '2026-10-31'],
  ];
  const posts: OccupiedPost[] = [];

  for (const [episode, day] of longs) {
    posts.push(post(`${episode}-long`, episode, 'full', at(day, '22:15', IST)));

    // Six Shorts, three a day, from the next day
    for (let i = 0; i < 6; i++) {
      const next = new Date(`${day}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1 + Math.floor(i / 3));
      posts.push(
        post(
          `${episode}-short-${i + 1}`,
          episode,
          'short',
          at(next.toISOString().slice(0, 10), OLD_SHORT_TIMES[i % 3]!, IST),
        ),
      );
    }
  }

  return posts;
}

function plan(posts: OccupiedPost[], movable = posts.map((p) => p.publishId)) {
  return planReplan({
    posts,
    movable: new Set(movable),
    moveLongs: true,
    longVideos: posts
      .filter((p) => p.contentType === 'full')
      .map((p) => ({
        publishId: p.publishId,
        episodeId: p.episodeId,
        connectionId: p.connectionId,
        at: p.at,
      })),
    cadenceOf: (_id, type) => NEW_RULES[type],
    from: NOW,
    now: NOW,
  });
}

const et = (date: Date) => formatInTimeZone(date, ET, 'EEE yyyy-MM-dd HH:mm');

describe('planReplan: the Ep 2–4 shape on new rules', () => {
  it('moves the Wednesday long video to an allowed day, and every long to 16:00 New York time, in order', () => {
    const result = plan(bulkScheduled());
    const longs = result.moves.filter((m) => m.contentType === 'full');

    expect(longs.map((m) => [m.publishId, et(m.scheduledAt)])).toEqual([
      ['ep2-long', 'Thu 2026-10-22 16:00'],
      ['ep3-long', 'Sun 2026-10-25 16:00'],
      // Wednesday 28th is not a posting day: the next allowed one
      ['ep4-long', 'Thu 2026-10-29 16:00'],
    ]);
    expect(result.unplaced).toEqual([]);
  });

  it('lays the Shorts at the four new times, at most four a day, the first an hour after its long video', () => {
    const result = plan(bulkScheduled());
    const shorts = result.moves.filter((m) => m.contentType === 'short');

    expect(shorts).toHaveLength(18);

    const perDay = new Map<string, number>();
    for (const short of shorts) {
      const day = formatInTimeZone(short.scheduledAt, ET, 'yyyy-MM-dd');
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      expect(NEW_RULES.short.slotTimes).toContain(
        formatInTimeZone(short.scheduledAt, ET, 'HH:mm'),
      );
    }
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(4);

    const first = (episode: string) =>
      shorts.find((s) => s.publishId === `${episode}-short-1`)!;
    expect(et(first('ep2').scheduledAt)).toBe('Thu 2026-10-22 17:00');
    expect(et(first('ep3').scheduledAt)).toBe('Sun 2026-10-25 17:00');
    expect(et(first('ep4').scheduledAt)).toBe('Thu 2026-10-29 17:00');

    // Each episode's Shorts keep their order, oldest first
    const order = shorts
      .slice()
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
      .map((s) => s.publishId);
    expect(order).toEqual(
      ['ep2', 'ep3', 'ep4'].flatMap((episode) =>
        Array.from({ length: 6 }, (_, i) => `${episode}-short-${i + 1}`),
      ),
    );
  });

  it('leaves a time chosen past the rules where it is, and counts it toward its day', () => {
    const posts = bulkScheduled();
    // Monday 26th, 23:30 in New York: the owner's experiment
    const manual = post(
      'manual',
      'ep9',
      'short',
      at('2026-10-26', '23:30', ET),
      {
        slotted: false,
      },
    );
    const result = plan(
      [...posts, manual],
      posts.map((p) => p.publishId),
    );

    expect(result.moves.map((m) => m.publishId)).not.toContain('manual');

    const monday = result.moves.filter(
      (m) =>
        m.contentType === 'short' &&
        formatInTimeZone(m.scheduledAt, ET, 'yyyy-MM-dd') === '2026-10-26',
    );
    expect(monday.length + 1).toBeLessThanOrEqual(4);
  });

  it('keeps a long video’s spacing from one that stays, and from one already out', () => {
    const posts = bulkScheduled();
    // Ep 1 went out on Wednesday the 21st; Ep 2 may not go before Saturday
    const published = post(
      'ep1-long',
      'ep1',
      'full',
      at('2026-10-21', '16:00', ET),
      { status: 'published' },
    );
    const result = plan(
      [published, ...posts],
      posts.map((p) => p.publishId),
    );

    expect(
      et(result.moves.find((m) => m.publishId === 'ep2-long')!.scheduledAt),
    ).toBe('Sat 2026-10-24 16:00');
  });

  it('moves nothing that is already where the rules put it', () => {
    const first = plan(bulkScheduled());
    const moved = bulkScheduled().map((p) => {
      const move = first.moves.find((m) => m.publishId === p.publishId);
      return move ? { ...p, at: move.slotAt, goesAt: move.scheduledAt } : p;
    });

    expect(plan(moved).moves).toEqual([]);
  });
});

describe('planReplan: Shorts only, behind a long video moved by hand', () => {
  it('lays its Shorts behind the new time, and moves the next episode’s back in order', () => {
    const posts = bulkScheduled();
    // Ep 2's long moved from Sunday to Monday 26th, 16:00 New York time
    const pinned = new Map([
      [
        'ep2-long',
        {
          slotAt: at('2026-10-26', '16:00', ET),
          scheduledAt: at('2026-10-26', '16:00', ET),
        },
      ],
    ]);
    const result = planReplan({
      posts,
      movable: new Set(
        posts.filter((p) => p.contentType === 'short').map((p) => p.publishId),
      ),
      pinned,
      moveLongs: false,
      longVideos: posts
        .filter((p) => p.contentType === 'full')
        .map((p) => ({
          publishId: p.publishId,
          episodeId: p.episodeId,
          connectionId: p.connectionId,
          at: p.at,
        })),
      cadenceOf: (_id, type) => NEW_RULES[type],
      from: NOW,
      now: NOW,
    });

    expect(result.moves.some((m) => m.contentType === 'full')).toBe(false);
    const short = (id: string) =>
      et(result.moves.find((m) => m.publishId === id)!.scheduledAt);
    expect(short('ep2-short-1')).toBe('Mon 2026-10-26 17:00');

    // Ep 3's Shorts come after Ep 2's, never before them
    const ep2Last = result.moves.find((m) => m.publishId === 'ep2-short-6')!;
    const ep3First = result.moves.find((m) => m.publishId === 'ep3-short-1')!;
    expect(ep3First.scheduledAt.getTime()).toBeGreaterThan(
      ep2Last.scheduledAt.getTime(),
    );
  });
});
