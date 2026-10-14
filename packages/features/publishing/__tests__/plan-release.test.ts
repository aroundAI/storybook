import { describe, expect, it } from 'vitest';

import {
  type ChannelCadence,
  DEFAULT_CADENCE,
  localDate,
  nextFreeSlot,
  resolveCadence,
} from '../src/lib/cadence/cadence';
import {
  type OccupiedPost,
  type PlanReleaseInput,
  type ReleaseItem,
  planRelease,
} from '../src/lib/cadence/plan-release';

/**
 * FILM-719. A channel posts on a rhythm: a long video every few days, its
 * Shorts one a day after it, and an episode's Shorts only until the next
 * episode's long video (owner, 2026-10-15).
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

describe('a release on a channel with nothing scheduled', () => {
  it('puts the long video in the first slot and one Short a day after it', () => {
    const result = plan({ items: [fullItem(), ...shorts(4)] });

    const full = result.placed.find((p) => p.contentType === 'full')!;
    expect(ist(full.slotAt)).toBe('2026-11-02');
    expect(istTime(full.slotAt)).toBe('17:00');

    const days = result.placed
      .filter((p) => p.contentType === 'short')
      .map((p) => `${ist(p.slotAt)} ${istTime(p.slotAt)}`);
    // 20 hours after 17:00 is 13:00 the next day, so the first is that 18:00
    expect(days).toEqual([
      '2026-11-03 18:00',
      '2026-11-04 18:00',
      '2026-11-05 18:00',
      '2026-11-06 18:00',
    ]);
    expect(result.held).toEqual([]);
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
      '2026-11-03 19:00',
      '2026-11-04 10:00',
      '2026-11-04 19:00',
      '2026-11-05 10:00',
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
    const occupied: OccupiedPost[] = [
      {
        publishId: 'p-ep1',
        connectionId: 'yt',
        episodeId: 'ep1',
        contentType: 'full',
        status: 'scheduled',
        at: new Date('2026-11-02T11:30:00Z'), // 17:00 IST Monday
      },
    ];
    const result = plan({
      episodeId: 'ep2',
      items: [fullItem()],
      occupied,
      anchors: new Map([['ep1', occupied[0]!.at]]),
    });

    expect(ist(result.placed[0]!.slotAt)).toBe('2026-11-05');
  });
});

describe('Shorts follow their own episode only', () => {
  // Episode 1: long video Monday 17:00 IST, Shorts daily from Tuesday
  const ep1Full = new Date('2026-11-02T11:30:00Z');
  const ep1Short = (day: number, id: string): OccupiedPost => ({
    publishId: id,
    connectionId: 'yt',
    episodeId: 'ep1',
    contentType: 'short',
    status: 'scheduled',
    at: new Date(Date.UTC(2026, 10, day, 12, 30)), // 18:00 IST
  });
  const occupied: OccupiedPost[] = [
    {
      publishId: 'ep1-full',
      connectionId: 'yt',
      episodeId: 'ep1',
      contentType: 'full',
      status: 'scheduled',
      at: ep1Full,
    },
    ep1Short(3, 's1'),
    ep1Short(4, 's2'),
    ep1Short(5, 's3'),
    ep1Short(6, 's4'),
    ep1Short(7, 's5'),
  ];

  it('holds an earlier episode’s Shorts scheduled after the next long video', () => {
    const result = plan({
      episodeId: 'ep2',
      items: [fullItem(), ...shorts(3)],
      occupied,
      anchors: new Map([['ep1', ep1Full]]),
    });

    const ep2Full = result.placed.find((p) => p.contentType === 'full')!;
    expect(ist(ep2Full.slotAt)).toBe('2026-11-05');

    // ep1's Shorts on the 3rd and 4th stay; the 5th, 6th and 7th are after
    // ep2's long video at 17:00 on the 5th
    expect(result.bumped.map((b) => b.publishId).sort()).toEqual([
      's3',
      's4',
      's5',
    ]);

    // ep2's Shorts take the days ep1's gave up
    expect(
      result.placed
        .filter((p) => p.contentType === 'short')
        .map((p) => ist(p.slotAt)),
    ).toEqual(['2026-11-06', '2026-11-07', '2026-11-08']);
  });

  it('holds this episode’s Shorts that do not fit before the next long video', () => {
    // Releasing ep1's Shorts when ep2's long video is already on the 5th
    const ep2Full = new Date('2026-11-05T11:30:00Z');
    const result = plan({
      episodeId: 'ep1',
      items: shorts(5),
      occupied: [
        {
          publishId: 'ep1-full',
          connectionId: 'yt',
          episodeId: 'ep1',
          contentType: 'full',
          status: 'scheduled',
          at: ep1Full,
        },
        {
          publishId: 'ep2-full',
          connectionId: 'yt',
          episodeId: 'ep2',
          contentType: 'full',
          status: 'scheduled',
          at: ep2Full,
        },
      ],
      anchors: new Map([
        ['ep1', ep1Full],
        ['ep2', ep2Full],
      ]),
    });

    expect(result.placed.map((p) => ist(p.slotAt))).toEqual([
      '2026-11-03',
      '2026-11-04',
    ]);
    expect(result.held).toHaveLength(3);
    expect(result.held.every((h) => h.reason === 'next-episode')).toBe(true);
    expect(result.held[0]!.before).toEqual(ep2Full);
    expect(result.bumped).toEqual([]);
  });

  it('never moves a Short already handed to the queue', () => {
    const queued = occupied.map((post) =>
      post.publishId === 's3' ? { ...post, status: 'queued' as const } : post,
    );
    const result = plan({
      episodeId: 'ep2',
      items: [fullItem()],
      occupied: queued,
      anchors: new Map([['ep1', ep1Full]]),
    });

    expect(result.bumped.map((b) => b.publishId)).not.toContain('s3');
  });

  it('re-queues held Shorts after everything on the channel', () => {
    const result = plan({
      episodeId: 'ep1',
      mode: 'append',
      items: shorts(2),
      occupied,
      anchors: new Map([['ep1', ep1Full]]),
    });

    expect(result.placed.map((p) => ist(p.slotAt))).toEqual([
      '2026-11-08',
      '2026-11-09',
    ]);
    expect(result.bumped).toEqual([]);
  });

  it('keeps each platform’s calendar separate', () => {
    const result = plan({
      episodeId: 'ep2',
      items: [fullItem(), ...shorts(2, 'ig')],
      occupied,
      anchors: new Map([['ep1', ep1Full]]),
    });

    // Instagram has no posts, so ep1's YouTube Shorts are not held
    expect(result.bumped).toEqual([]);
    expect(result.placed.filter((p) => p.connectionId === 'ig')).toHaveLength(
      2,
    );
  });
});

describe('the five-channel release in the owner’s question', () => {
  it('spreads five episodes on one channel without two episodes’ Shorts on a day', () => {
    let occupied: OccupiedPost[] = [];
    const anchors = new Map<string, Date>();

    for (let ep = 1; ep <= 5; ep++) {
      const episodeId = `ep${ep}`;
      const result = plan({
        episodeId,
        items: [fullItem(), ...shorts(5)],
        occupied,
        anchors,
        random: () => Math.random(),
        cadenceOf: (_, type) => cadence(type, { jitterMinutes: 20 }),
      });

      const bumpedIds = new Set(result.bumped.map((b) => b.publishId));
      occupied = occupied.filter((post) => !bumpedIds.has(post.publishId));
      anchors.set(episodeId, result.anchor!);
      occupied.push(
        ...result.placed.map((p) => ({
          publishId: `${episodeId}:${p.key}`,
          connectionId: p.connectionId,
          episodeId,
          contentType: p.contentType,
          status: 'scheduled' as const,
          at: p.slotAt,
        })),
      );
    }

    const fulls = occupied
      .filter((p) => p.contentType === 'full')
      .map((p) => p.at.getTime())
      .sort();
    expect(fulls).toHaveLength(5);
    for (let i = 1; i < fulls.length; i++) {
      expect(fulls[i]! - fulls[i - 1]!).toBeGreaterThanOrEqual(3 * 86_400_000);
    }

    const shortDays = occupied
      .filter((p) => p.contentType === 'short')
      .map((p) => ist(p.at));
    expect(new Set(shortDays).size).toBe(shortDays.length);

    // Each episode's Shorts sit between its long video and the next one
    const sortedAnchors = [...anchors.entries()].sort(
      (a, b) => a[1].getTime() - b[1].getTime(),
    );
    sortedAnchors.forEach(([episodeId, at], i) => {
      const next = sortedAnchors[i + 1]?.[1];
      for (const post of occupied.filter(
        (p) => p.episodeId === episodeId && p.contentType === 'short',
      )) {
        expect(post.at.getTime()).toBeGreaterThan(at.getTime());
        if (next) expect(post.at.getTime()).toBeLessThan(next.getTime());
      }
    });
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
      startAfterHours: 4,
      jitterMinutes: 10,
    });
  });
});
