import { describe, expect, it } from 'vitest';

import {
  type ChannelCadence,
  DEFAULT_CADENCE,
  localDate,
  nextFreeSlot,
  resolveCadence,
} from '../src/lib/cadence/cadence';
import {
  type EpisodeAnchor,
  type OccupiedPost,
  type PlanReleaseInput,
  type ReleaseItem,
  planRelease,
} from '../src/lib/cadence/plan-release';

/**
 * FILM-719, FILM-2209. A channel posts on a rhythm: a long video every few
 * days, and its Shorts from one queue, oldest episode first, never more a
 * day than its Short times (owner, 2026-10-18).
 */
const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-11-02T03:30:00Z'); // 09:00 IST, Monday

const cadence = (
  type: 'full' | 'short',
  overrides: Partial<ChannelCadence> = {},
): ChannelCadence => ({
  ...DEFAULT_CADENCE[type],
  timezone: TZ,
  jitterMinutes: 0,
  ...overrides,
});

const fullItem = (connectionId = 'yt'): ReleaseItem => ({
  key: `full:${connectionId}`,
  connectionId,
  contentType: 'full',
});

const shorts = (n: number, connectionId = 'yt'): ReleaseItem[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `short:${connectionId}:${i + 1}`,
    connectionId,
    contentType: 'short',
  }));

const plan = (overrides: Partial<PlanReleaseInput>) =>
  planRelease({
    episodeId: 'ep1',
    notBefore: NOW,
    items: [],
    cadenceOf: (_, type) => cadence(type),
    occupied: [],
    anchors: new Map(),
    now: NOW,
    random: () => 0.5,
    ...overrides,
  });

const ist = (at: Date) => localDate(at, TZ);
const istTime = (at: Date) =>
  at.toLocaleTimeString('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  });

const post = (
  publishId: string,
  episodeId: string,
  contentType: 'full' | 'short',
  when: Date,
  connectionId = 'yt',
): OccupiedPost => ({
  publishId,
  connectionId,
  episodeId,
  contentType,
  status: 'scheduled',
  at: when,
  goesAt: when,
});

/** Each episode's long videos, as the service reads them */
function anchorsOf(posts: readonly OccupiedPost[]) {
  const anchors = new Map<string, EpisodeAnchor>();
  for (const p of posts.filter((p) => p.contentType === 'full')) {
    const current = anchors.get(p.episodeId);
    const byChannel = new Map(current?.byChannel ?? []);
    if (
      !byChannel.has(p.connectionId) ||
      p.at < byChannel.get(p.connectionId)!
    ) {
      byChannel.set(p.connectionId, p.at);
    }
    anchors.set(p.episodeId, {
      earliest: current && current.earliest < p.at ? current.earliest : p.at,
      byChannel,
    });
  }
  return anchors;
}

const asOccupied = (
  episodeId: string,
  placed: ReturnType<typeof planRelease>['placed'],
): OccupiedPost[] =>
  placed.map((p) => ({
    publishId: `${episodeId}:${p.key}`,
    connectionId: p.connectionId,
    episodeId,
    contentType: p.contentType,
    status: 'scheduled',
    at: p.slotAt,
    goesAt: p.scheduledAt,
  }));

describe('a release on a channel with nothing scheduled', () => {
  it('puts the long video in the first slot and one Short a day after it', () => {
    const result = plan({ items: [fullItem(), ...shorts(4)] });

    const full = result.placed.find((p) => p.contentType === 'full')!;
    expect(ist(full.slotAt)).toBe('2026-11-02');
    expect(istTime(full.slotAt)).toBe('17:00');

    const days = result.placed
      .filter((p) => p.contentType === 'short')
      .map((p) => `${ist(p.slotAt)} ${istTime(p.slotAt)}`);
    // 2 hours after 17:00 is 19:00, past that day's 18:00
    expect(days).toEqual([
      '2026-11-03 18:00',
      '2026-11-04 18:00',
      '2026-11-05 18:00',
      '2026-11-06 18:00',
    ]);
    expect(result.unplaced).toEqual([]);
  });

  it('never puts two Shorts on one day when the channel takes one', () => {
    const result = plan({ items: [fullItem(), ...shorts(12)] });
    const days = result.placed
      .filter((p) => p.contentType === 'short')
      .map((p) => ist(p.slotAt));

    expect(new Set(days).size).toBe(days.length);
  });

  it('fills two slots a day when the channel has two', () => {
    const result = plan({
      items: [fullItem(), ...shorts(4)],
      cadenceOf: (_, type) =>
        type === 'short'
          ? cadence('short', { slotTimes: ['10:00', '19:00'] })
          : cadence('full'),
    });

    expect(
      result.placed
        .filter((p) => p.contentType === 'short')
        .map((p) => `${ist(p.slotAt)} ${istTime(p.slotAt)}`),
    ).toEqual([
      // 2 hours after the 17:00 long video
      '2026-11-02 19:00',
      '2026-11-03 10:00',
      '2026-11-03 19:00',
      '2026-11-04 10:00',
    ]);
  });

  it('lets a Short share a day with a long video (owner, 2026-10-15)', () => {
    const result = plan({
      items: [fullItem(), ...shorts(1)],
      cadenceOf: (_, type) =>
        type === 'short'
          ? cadence('short', { startAfterHours: 0, slotTimes: ['19:00'] })
          : cadence('full'),
    });

    const [full, short] = result.placed;
    expect(ist(full!.slotAt)).toBe(ist(short!.slotAt));
  });

  it('never schedules a Short before its long video plus the wait', () => {
    const result = plan({
      items: [fullItem(), ...shorts(5)],
      random: () => 0, // the most negative jitter
      cadenceOf: (_, type) => cadence(type, { jitterMinutes: 120 }),
    });
    const full = result.placed.find((p) => p.contentType === 'full')!;
    const wait = DEFAULT_CADENCE.short.startAfterHours * 3_600_000;

    for (const short of result.placed.filter(
      (p) => p.contentType === 'short',
    )) {
      expect(short.scheduledAt.getTime()).toBeGreaterThanOrEqual(
        full.slotAt.getTime() + wait,
      );
      expect(short.afterEpisodeFull).toBe(true);
    }
  });

  it('keeps jitter within its minutes and never before now', () => {
    const result = plan({
      items: [fullItem()],
      random: () => 1,
      cadenceOf: (_, type) => cadence(type, { jitterMinutes: 20 }),
    });
    const [full] = result.placed;

    expect(full!.scheduledAt.getTime() - full!.slotAt.getTime()).toBe(
      20 * 60_000,
    );
    expect(full!.scheduledAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('skips weekdays the channel does not post on', () => {
    // Monday 2 Nov; Shorts only at weekends
    const result = plan({
      items: [fullItem(), ...shorts(2)],
      cadenceOf: (_, type) =>
        type === 'short'
          ? cadence('short', { daysOfWeek: [0, 6] })
          : cadence('full'),
    });

    expect(
      result.placed
        .filter((p) => p.contentType === 'short')
        .map((p) => ist(p.slotAt)),
    ).toEqual(['2026-11-07', '2026-11-08']);
  });
});

describe('long videos on one channel', () => {
  it('go at least the channel’s days apart', () => {
    const occupied = [
      post('p-ep1', 'ep1', 'full', new Date('2026-11-02T11:30:00Z')), // 17:00 IST Monday
    ];
    const result = plan({
      episodeId: 'ep2',
      items: [fullItem()],
      occupied,
      anchors: anchorsOf(occupied),
    });

    expect(ist(result.placed[0]!.slotAt)).toBe('2026-11-05');
  });

  it('keeps 20:00 every 3 days across a daylight-saving change', () => {
    // US clocks go forward on Sunday 8 March 2026: 72 hours after Thursday
    // 20:00 EST is Sunday 21:00 EDT, past that day's 20:00
    const NY = 'America/New_York';
    const longs = (_: string, type: 'full' | 'short') =>
      cadence(type, { timezone: NY, slotTimes: ['20:00'], minDaysBetween: 3 });
    const now = new Date('2026-03-05T12:00:00Z');
    let occupied: OccupiedPost[] = [];

    for (const episodeId of ['ep1', 'ep2', 'ep3']) {
      const result = plan({
        episodeId,
        items: [fullItem()],
        cadenceOf: longs,
        occupied,
        anchors: anchorsOf(occupied),
        now,
        notBefore: now,
      });
      occupied = [...occupied, ...asOccupied(episodeId, result.placed)];
    }

    expect(
      occupied.map((p) =>
        p.at.toLocaleString('en-CA', { timeZone: NY, hour12: false }),
      ),
    ).toEqual([
      '2026-03-05, 20:00:00',
      '2026-03-08, 20:00:00',
      '2026-03-11, 20:00:00',
    ]);
  });
});

/** The owner's plan (2026-10-18): a long video at 20:00 every 3 days, Shorts at 11:00 and 17:00 */
const ownerPlan = (overrides: { everyNDays?: number } = {}) =>
  ((_: string, type: 'full' | 'short') =>
    type === 'full'
      ? cadence('full', { slotTimes: ['20:00'], minDaysBetween: 3 })
      : cadence('short', {
          slotTimes: ['11:00', '17:00'],
          startAfterHours: 2,
          everyNDays: overrides.everyNDays ?? 1,
        })) satisfies PlanReleaseInput['cadenceOf'];

const at = (p: { slotAt: Date } | { at: Date }) =>
  'slotAt' in p ? p.slotAt : p.at;
const dayTime = (p: { slotAt: Date } | { at: Date }) =>
  `${ist(at(p))} ${istTime(at(p))}`;

/** Releases the episodes in order on YouTube, as the owner would */
function releaseInOrder(
  episodes: ReadonlyArray<{ id: string; shorts: number }>,
  options: {
    occupied?: OccupiedPost[];
    now?: Date;
    cadenceOf?: PlanReleaseInput['cadenceOf'];
    random?: () => number;
  } = {},
) {
  let occupied = [...(options.occupied ?? [])];
  const now = options.now ?? NOW;

  for (const episode of episodes) {
    const result = plan({
      episodeId: episode.id,
      items: [fullItem(), ...shorts(episode.shorts)],
      cadenceOf: options.cadenceOf ?? ownerPlan(),
      occupied,
      anchors: anchorsOf(occupied),
      now,
      notBefore: now,
      random: options.random ?? (() => 0.5),
    });
    expect(result.unplaced).toEqual([]);
    occupied = [...occupied, ...asOccupied(episode.id, result.placed)];
  }

  return occupied;
}

function shortsPerDay(posts: readonly OccupiedPost[]) {
  const counts = new Map<string, number>();
  for (const p of posts.filter((p) => p.contentType === 'short')) {
    counts.set(ist(p.at), (counts.get(ist(p.at)) ?? 0) + 1);
  }
  return counts;
}

describe('one Shorts queue per channel, oldest first (FILM-2209)', () => {
  it('keeps posting episode 1’s 8 Shorts on day 3, beside long video 2, and on day 4, never more than 2 a day', () => {
    const occupied = releaseInOrder([
      { id: 'ep1', shorts: 8 },
      { id: 'ep2', shorts: 8 },
    ]);
    const of = (episodeId: string, type: 'full' | 'short') =>
      occupied.filter(
        (p) => p.episodeId === episodeId && p.contentType === type,
      );

    expect(of('ep1', 'full').map(dayTime)).toEqual(['2026-11-02 20:00']);
    expect(of('ep2', 'full').map(dayTime)).toEqual(['2026-11-05 20:00']);

    // Day 3 (5 Nov): long video 2 and two of episode 1's Shorts
    expect(of('ep1', 'short').map(dayTime)).toEqual([
      '2026-11-03 11:00',
      '2026-11-03 17:00',
      '2026-11-04 11:00',
      '2026-11-04 17:00',
      '2026-11-05 11:00',
      '2026-11-05 17:00',
      '2026-11-06 11:00',
      '2026-11-06 17:00',
    ]);

    // Episode 2's Shorts follow episode 1's
    expect(of('ep2', 'short').map(dayTime).slice(0, 2)).toEqual([
      '2026-11-07 11:00',
      '2026-11-07 17:00',
    ]);
    expect(Math.max(...shortsPerDay(occupied).values())).toBe(2);
  });

  it('appends a later batch: 5 episodes released 2 days after 4 go after them, and nothing earlier moves', () => {
    const first = releaseInOrder(
      ['ep1', 'ep2', 'ep3', 'ep4'].map((id) => ({ id, shorts: 8 })),
    );

    // Two days on: what was due has gone out
    const twoDaysLater = new Date(NOW.getTime() + 2 * 86_400_000);
    const before = first.map((p) =>
      p.goesAt <= twoDaysLater ? { ...p, status: 'published' as const } : p,
    );
    const all = releaseInOrder(
      ['ep5', 'ep6', 'ep7', 'ep8', 'ep9'].map((id) => ({ id, shorts: 8 })),
      { occupied: before, now: twoDaysLater },
    );

    // Nothing of the first batch moved
    expect(all.slice(0, before.length)).toEqual(before);

    // Long videos in episode order, 3 days apart, at 20:00
    const longs = all.filter((p) => p.contentType === 'full');
    expect(longs.map((p) => p.episodeId)).toEqual([
      'ep1',
      'ep2',
      'ep3',
      'ep4',
      'ep5',
      'ep6',
      'ep7',
      'ep8',
      'ep9',
    ]);
    longs.forEach((p, i) => {
      expect(istTime(p.at)).toBe('20:00');
      if (i > 0)
        expect(p.at.getTime() - longs[i - 1]!.at.getTime()).toBe(
          3 * 86_400_000,
        );
    });

    // Shorts in episode order, each after its own long video, 2 a day at most
    const queue = all
      .filter((p) => p.contentType === 'short')
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const order = queue.map((p) => Number(p.episodeId.slice(2)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const short of queue) {
      const long = longs.find((l) => l.episodeId === short.episodeId)!;
      expect(short.at.getTime()).toBeGreaterThan(long.at.getTime());
    }
    expect(Math.max(...shortsPerDay(all).values())).toBe(2);
  });

  it('never puts a Short ahead of one already queued on the channel', () => {
    // Episode 1's last Short was re-queued to the 10th, leaving days free
    const occupied = [
      post('ep1-full', 'ep1', 'full', new Date('2026-11-02T14:30:00Z')),
      post('ep1-s1', 'ep1', 'short', new Date('2026-11-03T05:30:00Z')),
      post('ep1-s2', 'ep1', 'short', new Date('2026-11-10T05:30:00Z')),
    ];
    const result = plan({
      episodeId: 'ep2',
      items: [fullItem(), ...shorts(2)],
      cadenceOf: ownerPlan(),
      occupied,
      anchors: anchorsOf(occupied),
    });

    expect(
      result.placed.filter((p) => p.contentType === 'short').map(dayTime),
    ).toEqual(['2026-11-10 17:00', '2026-11-11 11:00']);
  });

  it('places an episode’s Shorts after the next episode’s long video when they do not fit before it', () => {
    // Episode 1's Shorts, released after episode 2's long video is booked
    const occupied = [
      post('ep1-full', 'ep1', 'full', new Date('2026-11-02T14:30:00Z')),
      post('ep2-full', 'ep2', 'full', new Date('2026-11-05T14:30:00Z')),
    ];
    const result = plan({
      episodeId: 'ep1',
      items: shorts(8),
      cadenceOf: ownerPlan(),
      occupied,
      anchors: anchorsOf(occupied),
    });

    expect(result.unplaced).toEqual([]);
    expect(result.placed.map(dayTime).slice(-2)).toEqual([
      '2026-11-06 11:00',
      '2026-11-06 17:00',
    ]);
  });

  it('posts Shorts every 2 days when told to, still 2 a day, across releases', () => {
    const occupied = releaseInOrder(
      [
        { id: 'ep1', shorts: 6 },
        { id: 'ep2', shorts: 2 },
      ],
      { cadenceOf: ownerPlan({ everyNDays: 2 }) },
    );
    const days = [...shortsPerDay(occupied).entries()];

    expect(days).toEqual([
      ['2026-11-03', 2],
      ['2026-11-05', 2],
      ['2026-11-07', 2],
      ['2026-11-09', 2],
    ]);
  });

  it('never gives a long video and a Short one time on a channel', () => {
    // Episode 1's Short already holds 17:00 on the 5th, the long-video slot
    const shortAt = new Date('2026-11-05T11:30:00Z');
    const occupied = [
      post('ep1-full', 'ep1', 'full', new Date('2026-11-02T11:30:00Z')),
      post('ep1-s', 'ep1', 'short', shortAt),
    ];
    const result = plan({
      episodeId: 'ep2',
      items: [fullItem()],
      cadenceOf: (_, type) =>
        cadence(type, { slotTimes: ['17:00'], minDaysBetween: 3 }),
      occupied,
      anchors: anchorsOf(occupied),
    });

    const [full] = result.placed;
    expect(full!.slotAt).not.toEqual(shortAt);
    expect(dayTime(full!)).toBe('2026-11-06 17:00');

    // and a Short is never put on a long video's time
    const shortsFirst = plan({
      episodeId: 'ep1',
      items: shorts(1),
      cadenceOf: (_, type) =>
        cadence(type, { slotTimes: ['17:00'], startAfterHours: 0 }),
      occupied: [occupied[0]!],
      anchors: anchorsOf([occupied[0]!]),
    });
    expect(dayTime(shortsFirst.placed[0]!)).toBe('2026-11-03 17:00');
  });

  it('waits for the episode’s long video on the Short’s own channel', () => {
    // Episode 2's long video went out on Facebook on the 2nd; YouTube's
    // goes after episode 1's, on the 5th
    const occupied = [
      post('ep1-yt', 'ep1', 'full', new Date('2026-11-02T14:30:00Z')), // 20:00 IST
    ];
    const anchors = new Map([
      ...anchorsOf(occupied),
      [
        'ep2',
        {
          earliest: new Date('2026-11-02T11:30:00Z'),
          byChannel: new Map([['fb', new Date('2026-11-02T11:30:00Z')]]),
        },
      ],
    ]);
    const result = plan({
      episodeId: 'ep2',
      items: [fullItem('yt'), ...shorts(1, 'yt'), ...shorts(1, 'ig')],
      cadenceOf: ownerPlan(),
      occupied,
      anchors,
    });
    const placedOn = (id: string, type: 'full' | 'short') =>
      result.placed.find(
        (p) => p.connectionId === id && p.contentType === type,
      )!;

    expect(dayTime(placedOn('yt', 'full'))).toBe('2026-11-05 20:00');
    expect(dayTime(placedOn('yt', 'short'))).toBe('2026-11-06 11:00');
    // Instagram has no long video: its Reel follows the earliest one
    expect(dayTime(placedOn('ig', 'short'))).toBe('2026-11-03 11:00');
    expect(placedOn('ig', 'short').afterEpisodeFull).toBe(true);
  });

  it('keeps jittered posts on their slot’s day and in queue order', () => {
    const draws = [1, 0, 0, 1, 0, 1];
    let i = 0;
    const result = plan({
      items: [fullItem(), ...shorts(4)],
      random: () => draws[i++ % draws.length]!,
      cadenceOf: (_, type) =>
        type === 'full'
          ? cadence('full', { slotTimes: ['08:00'], jitterMinutes: 120 })
          : cadence('short', {
              slotTimes: ['00:30', '01:00'],
              startAfterHours: 0,
              jitterMinutes: 120,
            }),
    });
    const placedShorts = result.placed.filter((p) => p.contentType === 'short');

    for (const p of placedShorts) {
      expect(ist(p.scheduledAt)).toBe(ist(p.slotAt));
    }
    for (let n = 1; n < placedShorts.length; n++) {
      expect(placedShorts[n]!.scheduledAt.getTime()).toBeGreaterThanOrEqual(
        placedShorts[n - 1]!.scheduledAt.getTime() + 60_000,
      );
    }
  });

  it('says how far the Shorts queue runs past the last long video', () => {
    const occupied = releaseInOrder(
      ['ep1', 'ep2', 'ep3'].map((id) => ({ id, shorts: 8 })),
    );
    const result = plan({
      episodeId: 'ep4',
      items: [fullItem(), ...shorts(8)],
      cadenceOf: ownerPlan(),
      occupied,
      anchors: anchorsOf(occupied),
    });
    const [queue] = result.shortsQueues;

    // 6 Short slots between long videos, 8 Shorts an episode: 2 more a time
    expect(queue).toMatchObject({ connectionId: 'yt', queued: 32 });
    expect(dayTime({ at: queue!.longVideosEndAt! })).toBe('2026-11-11 20:00');
    expect(dayTime({ at: queue!.lastShortAt! })).toBe('2026-11-18 17:00');
    expect(queue!.daysAhead).toBe(6.9);
  });

  it('refuses nothing silently: an upload with no slot in a year is unplaced', () => {
    const result = plan({
      items: [fullItem(), ...shorts(1)],
      cadenceOf: (_, type) =>
        type === 'short'
          ? cadence('short', {
              daysOfWeek: [1],
              everyNDays: 7,
              slotTimes: ['18:00'],
            })
          : cadence('full'),
      occupied: [post('x', 'ep0', 'short', new Date('2026-11-03T12:30:00Z'))], // a Tuesday
    });

    // Mondays only, every 7 days from a Tuesday: never
    expect(result.unplaced).toEqual([
      { key: 'short:yt:1', connectionId: 'yt', contentType: 'short' },
    ]);
  });
});

describe('the five-channel release in the owner’s question', () => {
  it('spreads five episodes on one channel, one Short a day, oldest first', () => {
    const occupied = releaseInOrder(
      [1, 2, 3, 4, 5].map((n) => ({ id: `ep${n}`, shorts: 5 })),
      {
        cadenceOf: (_, type) => cadence(type, { jitterMinutes: 20 }),
        random: () => Math.random(),
      },
    );

    const fulls = occupied
      .filter((p) => p.contentType === 'full')
      .map((p) => p.at.getTime());
    expect(fulls).toHaveLength(5);
    for (let i = 1; i < fulls.length; i++) {
      expect(fulls[i]! - fulls[i - 1]!).toBeGreaterThanOrEqual(3 * 86_400_000);
    }

    expect(Math.max(...shortsPerDay(occupied).values())).toBe(1);

    const order = occupied
      .filter((p) => p.contentType === 'short')
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((p) => p.episodeId);
    expect(order).toEqual([...order].sort());
  });
});

describe('slots in the channel’s own timezone', () => {
  it('keeps 18:00 local across a daylight-saving change', () => {
    const ny = cadence('short', { timezone: 'America/New_York' });
    // US clocks go back on Sunday 1 November 2026
    let from = new Date('2026-10-30T12:00:00Z');
    const taken: Date[] = [];
    const times: string[] = [];

    for (let i = 0; i < 4; i++) {
      const slot = nextFreeSlot(ny, from, taken)!;
      taken.push(slot);
      from = slot;
      times.push(
        slot.toLocaleTimeString('en-GB', {
          timeZone: 'America/New_York',
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
    }

    expect(times).toEqual(['18:00', '18:00', '18:00', '18:00']);
    expect(taken.map((t) => t.getUTCHours())).toEqual([22, 22, 23, 23]);
  });

  it('counts a hand-scheduled post against its day', () => {
    const slot = nextFreeSlot(
      cadence('short'),
      NOW,
      [new Date('2026-11-02T05:00:00Z')], // 10:30 IST, not a slot
    );

    expect(ist(slot!)).toBe('2026-11-03');
  });
});

describe('the cadence a channel posts on', () => {
  it('is the defaults when the channel has no row, or a disabled one', () => {
    expect(resolveCadence(undefined, 'short', TZ)).toEqual({
      ...DEFAULT_CADENCE.short,
      timezone: TZ,
    });
    expect(resolveCadence(undefined, 'short', 'Not/AZone').timezone).toBe(
      'UTC',
    );
  });

  it('is the channel’s own row, slots in order', () => {
    expect(
      resolveCadence(
        {
          platform_connection_id: 'yt',
          content_type: 'short',
          timezone: 'Europe/London',
          slot_times: ['19:00', '09:00'],
          days_of_week: [1, 2, 3, 4, 5],
          min_days_between: 0,
          every_n_days: 2,
          start_after_hours: 4,
          jitter_minutes: 10,
          enabled: true,
        },
        'short',
        TZ,
      ),
    ).toEqual({
      timezone: 'Europe/London',
      slotTimes: ['09:00', '19:00'],
      daysOfWeek: [1, 2, 3, 4, 5],
      minDaysBetween: 0,
      everyNDays: 2,
      startAfterHours: 4,
      jitterMinutes: 10,
    });
  });
});
