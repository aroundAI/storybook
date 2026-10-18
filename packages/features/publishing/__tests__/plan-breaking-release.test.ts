import { describe, expect, it } from 'vitest';

import {
  type ChannelCadence,
  DEFAULT_CADENCE,
  localDate,
} from '../src/lib/cadence/cadence';
import {
  BREAKING_DEFAULTS,
  type PlanBreakingInput,
  boostDayTimes,
  planBreakingRelease,
  youtubeQuotaWarnings,
} from '../src/lib/cadence/plan-breaking-release';
import {
  type EpisodeAnchor,
  type OccupiedPost,
  type ReleaseItem,
  planRelease,
} from '../src/lib/cadence/plan-release';

/**
 * FILM-2210. Two weeks are scheduled when a story breaks: the breaking long
 * video goes now, its Shorts jump the channel's Shorts queue with extra
 * times for a few days, and the queued Shorts move back in order (owner,
 * 2026-10-18).
 */
const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-11-02T03:30:00Z'); // 09:00 IST, Monday

const cadence = (type: 'full' | 'short'): ChannelCadence => ({
  ...DEFAULT_CADENCE[type],
  timezone: TZ,
  jitterMinutes: 0,
  ...(type === 'full'
    ? { slotTimes: ['20:00'], minDaysBetween: 3 }
    : { slotTimes: ['11:00', '17:00'] }),
});

const items = (shortCount: number, connectionId = 'yt'): ReleaseItem[] => [
  { key: `full:${connectionId}`, connectionId, contentType: 'full' },
  ...Array.from({ length: shortCount }, (_, i) => ({
    key: `short:${connectionId}:${i + 1}`,
    connectionId,
    contentType: 'short' as const,
  })),
];

function anchorsOf(posts: readonly OccupiedPost[]) {
  const anchors = new Map<string, EpisodeAnchor>();
  for (const p of posts.filter((p) => p.contentType === 'full')) {
    const current = anchors.get(p.episodeId);
    anchors.set(p.episodeId, {
      earliest: current && current.earliest < p.at ? current.earliest : p.at,
      byChannel: new Map([
        ...(current?.byChannel ?? []),
        [p.connectionId, p.at],
      ]),
    });
  }
  return anchors;
}

/** Episodes 1..n released in order on the channel's cadence, as the service would */
function scheduledWeeks(episodes: number, shortsEach: number) {
  const occupied: OccupiedPost[] = [];
  for (let e = 1; e <= episodes; e++) {
    const episodeId = `ep${e}`;
    const plan = planRelease({
      episodeId,
      notBefore: NOW,
      items: items(shortsEach),
      cadenceOf: (_, type) => cadence(type),
      occupied,
      anchors: anchorsOf(occupied),
      now: NOW,
      random: () => 0.5,
    });
    for (const p of plan.placed) {
      occupied.push({
        publishId: `${episodeId}:${p.key}`,
        connectionId: p.connectionId,
        episodeId,
        contentType: p.contentType,
        status: 'scheduled',
        at: p.slotAt,
        goesAt: p.scheduledAt,
        slotted: true,
      });
    }
  }
  return occupied;
}

const breaking = (
  occupied: OccupiedPost[],
  overrides: Partial<PlanBreakingInput> = {},
) =>
  planBreakingRelease({
    episodeId: 'news',
    boost: { ...BREAKING_DEFAULTS.boost },
    startAfterHours: BREAKING_DEFAULTS.startAfterHours,
    items: items(6),
    cadenceOf: (_, type) => cadence(type),
    occupied,
    anchors: anchorsOf(occupied),
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

/** Every Short's slot after the plan: moved, unmoved, and the breaking ones */
function shortsAfter(
  occupied: OccupiedPost[],
  plan: ReturnType<typeof planBreakingRelease>,
) {
  return [
    ...occupied
      .filter((p) => p.contentType === 'short')
      .map((p) => ({
        id: p.publishId,
        breaking: false,
        at: plan.moves.find((m) => m.publishId === p.publishId)?.slotAt ?? p.at,
        was: p.at,
      })),
    ...plan.placed
      .filter((p) => p.contentType === 'short')
      .map((p) => ({ id: p.key, breaking: true, at: p.slotAt!, was: null })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
}

describe('a breaking release over two weeks already scheduled', () => {
  const occupied = scheduledWeeks(5, 6);
  const plan = breaking(occupied);
  const shorts = shortsAfter(occupied, plan);

  it('starts from two weeks of posts', () => {
    const days = new Set(occupied.map((p) => ist(p.at)));
    expect(days.size).toBeGreaterThanOrEqual(14);
    expect(plan.unplaced).toEqual([]);
  });

  it('sends the breaking long video at the next scheduler run', () => {
    const full = plan.placed.find((p) => p.contentType === 'full')!;

    expect(full.scheduledAt).toEqual(new Date(NOW.getTime() + 60_000));
    expect(full.slotAt).toBeNull();
  });

  it('moves no scheduled long video', () => {
    const fulls = new Set(
      occupied.filter((p) => p.contentType === 'full').map((p) => p.publishId),
    );

    expect(plan.moves.length).toBeGreaterThan(0);
    expect(plan.moves.filter((m) => fulls.has(m.publishId))).toEqual([]);
  });

  it('puts the breaking Shorts first, from an hour after the long video, on the extra times', () => {
    const breakingShorts = shorts.filter((s) => s.breaking);
    const firstNormal = shorts.find((s) => !s.breaking)!;

    expect(shorts.slice(0, 6).every((s) => s.breaking)).toBe(true);
    expect(breakingShorts[0]!.at.getTime()).toBeGreaterThanOrEqual(
      NOW.getTime() + 60_000 + 3_600_000,
    );
    expect(breakingShorts.map((s) => `${ist(s.at)} ${istTime(s.at)}`)).toEqual([
      '2026-11-02 11:00',
      '2026-11-02 14:00',
      '2026-11-02 17:00',
      '2026-11-02 19:00',
      '2026-11-03 11:00',
      '2026-11-03 14:00',
    ]);
    expect(plan.placed.filter((p) => p.extra)).toHaveLength(3);
    expect(firstNormal.at > breakingShorts[5]!.at).toBe(true);
    expect(
      plan.placed.every((p) => p.contentType === 'full' || p.afterEpisodeFull),
    ).toBe(true);
  });

  it('keeps the queued Shorts in their old order, each no earlier than it was', () => {
    const normal = shorts.filter((s) => !s.breaking);

    expect(normal.map((s) => s.id)).toEqual(
      [...normal]
        .sort((a, b) => a.was!.getTime() - b.was!.getTime())
        .map((s) => s.id),
    );
    expect(normal.every((s) => s.at >= s.was!)).toBe(true);
  });

  it('gives the queue a normal time the breaking Shorts left free on a boost day', () => {
    const firstNormal = shorts.find((s) => !s.breaking)!;

    expect(`${ist(firstNormal.at)} ${istTime(firstNormal.at)}`).toBe(
      '2026-11-03 17:00',
    );
  });

  it('lets only breaking Shorts pass 2 a day on the boost days, and no day pass 2 after them', () => {
    const boostDays = ['2026-11-02', '2026-11-03', '2026-11-04'];
    const byDay = new Map<string, { normal: number; total: number }>();
    for (const s of shorts) {
      const day = byDay.get(ist(s.at)) ?? { normal: 0, total: 0 };
      day.total++;
      if (!s.breaking) day.normal++;
      byDay.set(ist(s.at), day);
    }

    for (const [day, count] of byDay) {
      expect(count.normal, day).toBeLessThanOrEqual(2);
      if (!boostDays.includes(day))
        expect(count.total, day).toBeLessThanOrEqual(2);
    }
    expect(byDay.get('2026-11-02')!.total).toBe(4);
  });

  it('never gives two posts one time', () => {
    const times = [
      ...occupied
        .filter((p) => p.contentType === 'full')
        .map((p) => p.at.getTime()),
      ...shorts.map((s) => s.at.getTime()),
    ];

    expect(new Set(times).size).toBe(times.length);
  });

  it('says how the channel’s Shorts queue grew', () => {
    const [queue] = plan.queues;

    expect(queue!.before.queued).toBe(30);
    expect(queue!.after.queued).toBe(36);
    expect(queue!.after.lastShortAt! > queue!.before.lastShortAt!).toBe(true);
  });
});

describe('a breaking release at a time the owner gives', () => {
  it('goes at 20:00 tonight beside the long video already there', () => {
    const occupied = scheduledWeeks(5, 6);
    const tonight = new Date('2026-11-02T14:30:00Z'); // 20:00 IST
    const scheduledTonight = occupied.find(
      (p) => p.contentType === 'full' && p.at.getTime() === tonight.getTime(),
    );
    const plan = breaking(occupied, { at: tonight });

    expect(scheduledTonight).toBeDefined();
    expect(
      plan.placed.find((p) => p.contentType === 'full')!.scheduledAt,
    ).toEqual(tonight);
    expect(plan.moves.map((m) => m.publishId)).not.toContain(
      scheduledTonight!.publishId,
    );
    // Its Shorts start the next morning: 21:00 is past the day's last time
    expect(ist(shortsAfter(occupied, plan).find((s) => s.breaking)!.at)).toBe(
      '2026-11-03',
    );
  });
});

describe('the hour after the long video', () => {
  it('keeps a breaking Short off a time less than an hour after its long video', () => {
    const plan = breaking([], {
      at: new Date('2026-11-02T05:15:00Z'), // 10:45 IST
      items: items(1),
    });
    const short = plan.placed.find((p) => p.contentType === 'short')!;

    expect(istTime(short.slotAt!)).toBe('14:00');
  });
});

describe('posts that stay where they are', () => {
  const at = (iso: string) => new Date(iso);
  const short = (
    publishId: string,
    when: Date,
    status: OccupiedPost['status'] = 'scheduled',
    slotted = true,
  ): OccupiedPost => ({
    publishId,
    connectionId: 'yt',
    episodeId: 'old',
    contentType: 'short',
    status,
    at: when,
    goesAt: when,
    slotted,
  });

  it('leaves a queued Short at the front, and moves the rest around it', () => {
    const occupied = [
      short('queued', at('2026-11-02T05:30:00Z'), 'queued'), // Mon 11:00
      short('n1', at('2026-11-02T11:30:00Z')), // Mon 17:00
      short('n2', at('2026-11-03T05:30:00Z')), // Tue 11:00
      short('n3', at('2026-11-03T11:30:00Z')), // Tue 17:00
    ];
    const plan = breaking(occupied, { items: items(3) });
    const breakingSlots = plan.placed
      .filter((p) => p.contentType === 'short')
      .map((p) => `${ist(p.slotAt!)} ${istTime(p.slotAt!)}`);

    expect(plan.moves.map((m) => m.publishId)).not.toContain('queued');
    expect(breakingSlots).toEqual([
      '2026-11-02 14:00',
      '2026-11-02 17:00',
      '2026-11-02 19:00',
    ]);
    expect(
      plan.moves.map((m) => [
        m.publishId,
        `${ist(m.slotAt)} ${istTime(m.slotAt)}`,
      ]),
    ).toEqual([
      ['n1', '2026-11-03 11:00'],
      ['n2', '2026-11-03 17:00'],
      ['n3', '2026-11-04 11:00'],
    ]);
  });

  it('never pulls a queued Short forward into a gap', () => {
    const occupied = [
      short('n1', at('2026-11-02T11:30:00Z')), // Mon 17:00
      short('n2', at('2026-11-05T05:30:00Z')), // Thu 11:00
    ];
    const plan = breaking(occupied, {
      items: items(1),
      boost: { extraPerDay: 0, days: 1 },
    });

    expect(plan.placed.find((p) => p.contentType === 'short')!.slotAt).toEqual(
      at('2026-11-02T05:30:00Z'),
    );
    expect(plan.moves).toEqual([]);
  });

  it('leaves a Short scheduled by hand where it is', () => {
    const occupied = [
      short('hand', at('2026-11-02T08:30:00Z'), 'scheduled', false),
    ]; // Mon 14:00
    const plan = breaking(occupied, { items: items(2) });

    expect(plan.moves).toEqual([]);
    expect(
      plan.placed
        .filter((p) => p.contentType === 'short')
        .map((p) => istTime(p.slotAt!)),
    ).toEqual(['11:00', '17:00']);
  });
});

describe('the boost', () => {
  it('spreads the extra times into the widest gaps of the day', () => {
    expect(boostDayTimes(['11:00', '17:00'], 2)).toEqual([
      { time: '11:00', extra: false },
      { time: '14:00', extra: true },
      { time: '17:00', extra: false },
      { time: '19:00', extra: true },
    ]);
    expect(boostDayTimes(['18:00'], 0)).toEqual([
      { time: '18:00', extra: false },
    ]);
  });

  it('is settable: none extra means the breaking Shorts take only normal times', () => {
    const plan = breaking([], { boost: { extraPerDay: 0, days: 1 } });

    expect(plan.placed.filter((p) => p.extra)).toEqual([]);
    expect(
      plan.placed
        .filter((p) => p.contentType === 'short')
        .map((p) => `${ist(p.slotAt!)} ${istTime(p.slotAt!)}`),
    ).toEqual([
      '2026-11-02 11:00',
      '2026-11-02 17:00',
      '2026-11-03 11:00',
      '2026-11-03 17:00',
      '2026-11-04 11:00',
      '2026-11-04 17:00',
    ]);
  });

  it('gives Shorts past the boost the normal times, ahead of the queue', () => {
    const plan = breaking([], {
      items: items(8),
      boost: { extraPerDay: 1, days: 1 },
    });
    const days = plan.placed
      .filter((p) => p.contentType === 'short')
      .map((p) => ist(p.slotAt!));

    expect(days.filter((d) => d === '2026-11-02')).toHaveLength(3);
    expect(days.filter((d) => d === '2026-11-03')).toHaveLength(2);
    expect(days.filter((d) => d === '2026-11-04')).toHaveLength(2);
  });
});

describe('the YouTube upload budget', () => {
  const pacificNoon = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => new Date(Date.parse('2026-11-02T20:00:00Z') + i * 60_000),
    );

  it('warns past 6 uploads in a Pacific day', () => {
    expect(youtubeQuotaWarnings(pacificNoon(7))).toEqual([
      { day: '2026-11-02', uploads: 7 },
    ]);
  });

  it('says nothing at 6', () => {
    expect(youtubeQuotaWarnings(pacificNoon(6))).toEqual([]);
  });
});
