import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelCadenceRow } from '../src/lib/cadence/cadence';
import type { ChannelCadenceInput } from '../src/lib/schemas/schedule-release.schema';
import {
  replanSchedule,
  reschedulePublishes,
  saveCadenceAndReplan,
} from '../src/server/reschedule.service';

/**
 * FILM-2213. A scheduled post's time changed in place, and new posting
 * rules re-planning what is scheduled, end to end through the service on
 * an in-memory PostgREST that keeps `publishes_channel_slot_key` and runs
 * reschedule_publishes all or nothing, merging each move's metadata. A
 * post uploaded to YouTube ahead of its time is moved there first, through
 * the real youtube-staged.service against a fake YouTube.
 */

vi.mock('server-only', () => ({}));
vi.mock('../src/server/connection-tokens', () => ({
  getAccessToken: async () => ({ accessToken: 'token' }),
}));

const events = vi.hoisted(() => ({
  log: [] as string[],
  refuse: null as string | null,
}));
vi.mock('../src/providers/youtube/youtube-provider', () => ({
  YouTubeProvider: class {
    async updatePublishAt(videoId: string, publishAt: string) {
      if (events.refuse) throw new Error(events.refuse);
      events.log.push(`youtube ${videoId} ${publishAt}`);
      return 'set';
    }
  },
}));

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-11-02T03:30:00Z'); // Monday, 09:00 IST
const YT = '00000000-0000-4000-8000-0000000000c1';
const FB = '00000000-0000-4000-8000-0000000000c3';
const USER = 'user-1';

type Row = Record<string, unknown> & { id: string };

const ON_SLOT = ['scheduled', 'queued', 'publishing', 'published'];

const ist = (day: string, time: string) =>
  fromZonedTime(`${day}T${time}:00`, TZ).toISOString();
const istOf = (iso: unknown) =>
  formatInTimeZone(new Date(String(iso)), TZ, 'yyyy-MM-dd HH:mm');

/** PostgREST over arrays, with the slot index and reschedule_publishes */
function fakeDb() {
  const tables: Record<string, Row[]> = {
    publishes: [],
    platform_connections: [
      {
        id: YT,
        account_id: 'team',
        platform: 'youtube',
        platform_account_name: 'Story YT',
      },
      {
        id: FB,
        account_id: 'team',
        platform: 'facebook',
        platform_account_name: 'Story FB',
      },
    ],
    channel_posting_cadences: [],
    project_publishing_configs: [
      {
        id: 'c1',
        project_id: 'project',
        platform_connection_id: YT,
        is_enabled: true,
      },
      {
        id: 'c2',
        project_id: 'project',
        platform_connection_id: FB,
        is_enabled: true,
      },
    ],
  };
  const rpcFailures: string[] = [];

  const slotTaken = (row: Row, others: Row[]) =>
    !!row.slot_at &&
    ON_SLOT.includes(String(row.status)) &&
    others.some(
      (other) =>
        other.id !== row.id &&
        other.platform_connection_id === row.platform_connection_id &&
        other.slot_at === row.slot_at &&
        ON_SLOT.includes(String(other.status)),
    );

  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let op: 'select' | 'upsert' = 'select';
    let values: Row | null = null;
    let range: [number, number] | null = null;

    const run = () => {
      if (op === 'upsert') {
        const rows = tables[table]!;
        const index = rows.findIndex(
          (row) =>
            row.platform_connection_id === values!.platform_connection_id &&
            row.content_type === values!.content_type,
        );
        if (index >= 0) rows[index] = { ...values! };
        else rows.push({ ...values! });
        events.log.push(`upsert ${table}`);
        return { data: null, error: null };
      }

      const rows = tables[table]!.filter((row) => filters.every((f) => f(row)));
      return {
        data: range ? rows.slice(range[0], range[1] + 1) : rows,
        error: null,
      };
    };

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
        filters.push((row) => !!row[column] && String(row[column]) >= value);
        return q;
      },
      order: () => q,
      limit: () => q,
      range: (start: number, end: number) => {
        range = [start, end];
        return q;
      },
      upsert: (row: Row) => {
        op = 'upsert';
        values = row;
        return q;
      },
      maybeSingle: () => {
        const result = run();
        return Promise.resolve({
          ...result,
          data: Array.isArray(result.data)
            ? (result.data[0] ?? null)
            : result.data,
        });
      },
      then: (resolve: (value: unknown) => unknown) => resolve(run()),
    };

    return q;
  };

  /** reschedule_publishes: every move or none, metadata merged */
  const rpc = async (
    name: string,
    args: {
      p_moves: Array<{
        id: string;
        slot_at: string | null;
        scheduled_at: string;
        metadata?: Record<string, unknown>;
      }>;
    },
  ) => {
    if (name !== 'reschedule_publishes') throw new Error(name);
    events.log.push('rpc');

    const failure = rpcFailures.shift();
    if (failure) {
      return { data: null, error: { code: failure, message: failure } };
    }

    const publishes = tables.publishes!;
    const before = publishes.map((row) => structuredClone(row));
    const undo = () => publishes.splice(0, publishes.length, ...before);

    const moved = args.p_moves.map((move) =>
      publishes.find((row) => row.id === move.id && row.status === 'scheduled'),
    );
    if (moved.some((row) => !row)) {
      return { data: null, error: { code: '55000', message: 'not scheduled' } };
    }

    for (const row of moved) row!.slot_at = null;
    args.p_moves.forEach((move, i) =>
      Object.assign(moved[i]!, {
        slot_at: move.slot_at,
        scheduled_at: move.scheduled_at,
        metadata: move.metadata
          ? { ...(moved[i]!.metadata as object), ...move.metadata }
          : moved[i]!.metadata,
      }),
    );

    if (publishes.some((row) => slotTaken(row, publishes))) {
      undo();
      return { data: null, error: { code: '23505', message: 'slot' } };
    }

    return { data: [], error: null };
  };

  return {
    client: { from, rpc } as unknown as Parameters<
      typeof reschedulePublishes
    >[0],
    tables,
    rpcFailures,
  };
}

const cadenceRow = (
  connectionId: string,
  contentType: 'full' | 'short',
  overrides: Partial<ChannelCadenceRow> = {},
): ChannelCadenceRow => ({
  platform_connection_id: connectionId,
  content_type: contentType,
  timezone: TZ,
  slot_times: contentType === 'full' ? ['20:00'] : ['11:00', '17:00'],
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  min_days_between: contentType === 'full' ? 3 : 0,
  every_n_days: 1,
  start_after_hours: 2,
  jitter_minutes: 0,
  enabled: true,
  ...overrides,
});

const EPISODES: Record<string, { number: number; title: string }> = {
  ep2: { number: 2, title: 'Two' },
  ep3: { number: 3, title: 'Three' },
  ep4: { number: 4, title: 'Four' },
  ep5: { number: 5, title: 'Five' },
};

function publish(
  id: string,
  episode: string,
  connectionId: string,
  contentType: 'full' | 'short',
  at: string,
  extra: Partial<Row> = {},
): Row {
  return {
    id,
    episode_id: episode,
    platform: connectionId === YT ? 'youtube' : 'facebook',
    platform_connection_id: connectionId,
    content_type: contentType,
    status: 'scheduled',
    slot_at: at,
    scheduled_at: at,
    published_at: null,
    title: `${episode} ${id}`,
    tags: ['story', episode],
    thumbnail_url: `https://cdn/${episode}.png`,
    metadata: { shortsGroupId: contentType === 'short' ? `${id}-g` : null },
    release_priority: 'normal',
    episodes: { ...EPISODES[episode], deleted_at: null },
    ...extra,
  };
}

/**
 * Ep 2–4 long videos every 3 days at 20:00 IST on YouTube (Ep 3 on
 * Facebook too), two Shorts a day behind each, and Ep 5's Shorts, which
 * has no long video, queued straight after Ep 3's
 */
function seed(db: ReturnType<typeof fakeDb>) {
  db.tables.channel_posting_cadences!.push(
    cadenceRow(YT, 'full') as unknown as Row,
    cadenceRow(YT, 'short') as unknown as Row,
    cadenceRow(FB, 'full') as unknown as Row,
    cadenceRow(FB, 'short') as unknown as Row,
  );
  db.tables.publishes!.push(
    publish('ep2-long', 'ep2', YT, 'full', ist('2026-11-02', '20:00')),
    publish('ep2-s1', 'ep2', YT, 'short', ist('2026-11-03', '11:00')),
    publish('ep2-s2', 'ep2', YT, 'short', ist('2026-11-03', '17:00')),
    publish('ep3-long', 'ep3', YT, 'full', ist('2026-11-05', '20:00')),
    publish('ep3-long-fb', 'ep3', FB, 'full', ist('2026-11-05', '20:00')),
    publish('ep3-s1', 'ep3', YT, 'short', ist('2026-11-06', '11:00')),
    publish('ep3-s2', 'ep3', YT, 'short', ist('2026-11-06', '17:00')),
    publish('ep3-s3', 'ep3', YT, 'short', ist('2026-11-07', '11:00')),
    publish('ep5-s1', 'ep5', YT, 'short', ist('2026-11-07', '17:00')),
    publish('ep5-s2', 'ep5', YT, 'short', ist('2026-11-08', '11:00')),
    publish('ep4-long', 'ep4', YT, 'full', ist('2026-11-09', '20:00')),
    publish('ep4-s1', 'ep4', YT, 'short', ist('2026-11-10', '11:00')),
  );
}

let db: ReturnType<typeof fakeDb>;

const row = (id: string) => db.tables.publishes!.find((r) => r.id === id)!;
const snapshot = () => structuredClone(db.tables.publishes);

beforeEach(() => {
  events.log.length = 0;
  events.refuse = null;
  db = fakeDb();
  seed(db);
});

const actor = { userId: USER, via: 'ui' as const, note: 'testing 8 pm' };

describe('moving an episode’s long video', () => {
  it('moves both platform rows in place, keeping title, tags and thumbnail, with history', async () => {
    const before = {
      yt: { ...row('ep3-long') },
      fb: { ...row('ep3-long-fb') },
    };
    const at = ist('2026-11-06', '20:00');

    const result = await reschedulePublishes(
      db.client,
      actor,
      { episodeId: 'ep3', contentType: 'full', scheduledAt: at },
      { now: NOW },
    );

    expect(result.ok).toBe(true);
    for (const [id, old] of [
      ['ep3-long', before.yt],
      ['ep3-long-fb', before.fb],
    ] as const) {
      const moved = row(id);
      expect(moved.scheduled_at).toBe(at);
      expect(moved.slot_at).toBe(at);
      expect(moved.status).toBe('scheduled');
      expect(moved.title).toBe(old.title);
      expect(moved.tags).toEqual(old.tags);
      expect(moved.thumbnail_url).toBe(old.thumbnail_url);
      expect(
        (moved.metadata as { scheduleHistory: unknown[] }).scheduleHistory,
      ).toEqual([
        {
          from: old.scheduled_at,
          to: at,
          at: NOW.toISOString(),
          by: USER,
          via: 'ui',
          note: 'testing 8 pm',
        },
      ]);
    }
    // In place: no row was added or removed, and one write did it all
    expect(db.tables.publishes).toHaveLength(12);
    expect(events.log.filter((e) => e === 'rpc')).toHaveLength(1);
  });

  it('lays its Shorts behind the new time, and moves the Shorts queued behind them back in order', async () => {
    await reschedulePublishes(
      db.client,
      actor,
      {
        episodeId: 'ep3',
        contentType: 'full',
        scheduledAt: ist('2026-11-06', '20:00'),
      },
      { now: NOW },
    );

    expect(
      ['ep3-s1', 'ep3-s2', 'ep3-s3', 'ep5-s1', 'ep5-s2', 'ep4-s1'].map((id) => [
        id,
        istOf(row(id).scheduled_at),
      ]),
    ).toEqual([
      ['ep3-s1', '2026-11-07 11:00'],
      ['ep3-s2', '2026-11-07 17:00'],
      ['ep3-s3', '2026-11-08 11:00'],
      ['ep5-s1', '2026-11-08 17:00'],
      ['ep5-s2', '2026-11-09 11:00'],
      ['ep4-s1', '2026-11-10 11:00'],
    ]);
    // Shorts before the long video's old time stay
    expect(istOf(row('ep2-s1').scheduled_at)).toBe('2026-11-03 11:00');
    expect(
      (row('ep5-s1').metadata as { scheduleHistory: Array<{ via: string }> })
        .scheduleHistory[0]!.via,
    ).toBe('ui');
  });

  it('previews the same moves, writing nothing', async () => {
    const before = snapshot();

    const result = await reschedulePublishes(
      db.client,
      actor,
      {
        episodeId: 'ep3',
        contentType: 'full',
        scheduledAt: ist('2026-11-06', '20:00'),
      },
      { now: NOW, dryRun: true },
    );

    expect(
      result.ok && result.data.moves.map((m) => m.publishId).sort(),
    ).toEqual(
      [
        'ep3-long',
        'ep3-long-fb',
        'ep3-s1',
        'ep3-s2',
        'ep3-s3',
        'ep5-s1',
        'ep5-s2',
      ].sort(),
    );
    expect(result.ok && result.data.moves[0]!.episode).toBe('Ep 3 · Three');
    expect(db.tables.publishes).toEqual(before);
    expect(events.log).toEqual([]);
  });
});

describe('the posting rules', () => {
  // Two days after Ep 3's old day, one before Ep 4's: closer than 3 days
  const tooClose = ist('2026-11-07', '20:00');

  it('refuse a time past them, saying why, and nothing moves', async () => {
    const before = snapshot();

    const result = await reschedulePublishes(
      db.client,
      actor,
      { episodeId: 'ep3', contentType: 'full', scheduledAt: tooClose },
      { now: NOW },
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.refusal).toContain('3 days apart');
    expect(!result.ok && result.refusal).toContain(
      'override the posting rules for this experiment',
    );
    expect(db.tables.publishes).toEqual(before);
  });

  it('refuse a day the channel does not post on', async () => {
    db.tables.channel_posting_cadences!.splice(
      0,
      1,
      cadenceRow(YT, 'full', {
        days_of_week: [0, 1, 2, 3, 5, 6],
      }) as unknown as Row,
    );

    const result = await reschedulePublishes(
      db.client,
      actor,
      // Thursday
      { publishId: 'ep3-long', scheduledAt: ist('2026-11-05', '21:00') },
      { now: NOW },
    );

    expect(!result.ok && result.refusal).toContain('Thursdays');
  });

  it('with ignoreCadence, accept it, mark it manualTime, and give it no cadence slot', async () => {
    const result = await reschedulePublishes(
      db.client,
      actor,
      {
        episodeId: 'ep3',
        contentType: 'full',
        scheduledAt: tooClose,
        ignoreCadence: true,
      },
      { now: NOW },
    );

    expect(result.ok && result.data.manualTime).toBe(true);
    for (const id of ['ep3-long', 'ep3-long-fb']) {
      expect(row(id).scheduled_at).toBe(tooClose);
      expect(row(id).slot_at).toBeNull();
      expect((row(id).metadata as { manualTime?: boolean }).manualTime).toBe(
        true,
      );
    }
  });

  it('a preview returns the refusal with the moves, for the override checkbox', async () => {
    const result = await reschedulePublishes(
      db.client,
      actor,
      { episodeId: 'ep3', contentType: 'full', scheduledAt: tooClose },
      { now: NOW, dryRun: true },
    );

    expect(result.ok && result.data.cadenceRefusal).toContain('3 days apart');
    expect(result.ok && result.data.moves.length).toBeGreaterThan(0);
  });
});

describe('a post uploaded to YouTube ahead of its time (KB-214)', () => {
  const staged = (publishAt: string) => ({
    youtube: { videoId: 'v3', stagedAt: '', publishAt, delays: [] },
  });

  it('is moved on YouTube before the database, and records the new publishAt', async () => {
    row('ep3-long').metadata = staged(String(row('ep3-long').scheduled_at));
    const at = ist('2026-11-06', '20:00');

    const result = await reschedulePublishes(
      db.client,
      actor,
      { publishId: 'ep3-long', scheduledAt: at },
      { now: NOW },
    );

    expect(result.ok).toBe(true);
    expect(events.log).toEqual([`youtube v3 ${at}`, 'rpc']);
    expect(
      (row('ep3-long').metadata as { youtube: { publishAt: string } }).youtube
        .publishAt,
    ).toBe(at);
  });

  it('a YouTube refusal moves nothing, here or there, and says why', async () => {
    row('ep3-long').metadata = staged(String(row('ep3-long').scheduled_at));
    events.refuse = 'YouTube refused to move the video’s publish time: quota';
    const before = snapshot();

    const result = await reschedulePublishes(
      db.client,
      actor,
      { publishId: 'ep3-long', scheduledAt: ist('2026-11-06', '20:00') },
      { now: NOW },
    );

    expect(!result.ok && result.refusal).toContain('quota');
    expect(events.log).not.toContain('rpc');
    expect(db.tables.publishes).toEqual(before);
  });

  it('a write that fails after YouTube moved puts YouTube’s time back', async () => {
    const old = String(row('ep3-long').scheduled_at);
    row('ep3-long').metadata = staged(old);
    db.rpcFailures.push('XX000');
    const at = ist('2026-11-06', '20:00');

    await expect(
      reschedulePublishes(
        db.client,
        actor,
        { publishId: 'ep3-long', scheduledAt: at },
        { now: NOW },
      ),
    ).rejects.toThrow('Could not move the posts');

    expect(events.log).toEqual([
      `youtube v3 ${at}`,
      'rpc',
      `youtube v3 ${old}`,
    ]);
  });
});

describe('what cannot move', () => {
  it.each([
    ['published', 'already gone out'],
    ['publishing', 'being posted right now'],
    ['queued', 'being posted right now'],
    ['failed', 'failed to post'],
  ])('a %s post is refused in plain words', async (status, words) => {
    row('ep3-s1').status = status;

    const result = await reschedulePublishes(
      db.client,
      actor,
      { publishId: 'ep3-s1', scheduledAt: ist('2026-11-20', '11:00') },
      { now: NOW },
    );

    expect(!result.ok && result.refusal).toContain(words);
  });

  it.each([
    ['in the past', '2026-11-01T00:00:00Z'],
    [
      'ten minutes from now',
      new Date(NOW.getTime() + 10 * 60_000).toISOString(),
    ],
  ])('a time %s is refused', async (_name, at) => {
    const result = await reschedulePublishes(
      db.client,
      actor,
      { publishId: 'ep3-s1', scheduledAt: at },
      { now: NOW },
    );

    expect(!result.ok && result.refusal).toContain('15 minutes from now');
  });
});

describe('new posting rules re-plan what is scheduled', () => {
  const RULES: ChannelCadenceInput = {
    connectionId: YT,
    contentType: 'short',
    timezone: TZ,
    slotTimes: ['09:00', '13:00', '17:00', '21:00'],
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    minDaysBetween: 0,
    everyNDays: 1,
    startAfterHours: 1,
    jitterMinutes: 0,
    enabled: true,
  };

  it('saves the rules, then moves the channel’s Shorts onto them, leaving a manualTime post', async () => {
    row('ep5-s2').metadata = { manualTime: true };
    const manual = { ...row('ep5-s2') };

    const result = await saveCadenceAndReplan(db.client, actor, RULES, {
      now: NOW,
    });

    expect(result.ok && result.data.saved).toBe(true);
    expect(events.log[0]).toBe('upsert channel_posting_cadences');
    expect(
      db.tables.channel_posting_cadences!.find(
        (r) => r.platform_connection_id === YT && r.content_type === 'short',
      )!.slot_times,
    ).toEqual(RULES.slotTimes);

    // Ep 2's Shorts: from 21:00 on its long video's day, four a day
    expect(istOf(row('ep2-s1').scheduled_at)).toBe('2026-11-02 21:00');
    expect(istOf(row('ep2-s2').scheduled_at)).toBe('2026-11-03 09:00');
    expect(row('ep5-s2')).toEqual(manual);
    expect(
      (row('ep2-s1').metadata as { scheduleHistory: Array<{ via: string }> })
        .scheduleHistory[0]!.via,
    ).toBe('replan');
    expect(result.ok && result.data.replan!.moves.length).toBeGreaterThan(0);
  });

  it('a dry run saves nothing and moves nothing, and shows what saving would move', async () => {
    const before = snapshot();
    const rules = structuredClone(db.tables.channel_posting_cadences);

    const result = await saveCadenceAndReplan(db.client, actor, RULES, {
      now: NOW,
      dryRun: true,
    });

    expect(result.ok && result.data.saved).toBe(false);
    expect(
      result.ok &&
        result.data.replan!.moves.find((m) => m.publishId === 'ep2-s1')?.to,
    ).toBe(ist('2026-11-02', '21:00'));
    expect(db.tables.publishes).toEqual(before);
    expect(db.tables.channel_posting_cadences).toEqual(rules);
  });

  it('a re-plan that fails still saves the rules, and says why nothing moved', async () => {
    db.rpcFailures.push('XX000');
    const before = snapshot();

    const result = await saveCadenceAndReplan(db.client, actor, RULES, {
      now: NOW,
    });

    expect(result.ok && result.data.saved).toBe(true);
    expect(result.ok && result.data.replanRefusal).toContain(
      'could not be re-planned',
    );
    expect(db.tables.publishes).toEqual(before);
    expect(
      db.tables.channel_posting_cadences!.find(
        (r) => r.platform_connection_id === YT && r.content_type === 'short',
      )!.slot_times,
    ).toEqual(RULES.slotTimes);
  });

  it('a post YouTube refuses to move stays, and the rest move around it', async () => {
    row('ep2-s1').metadata = {
      youtube: {
        videoId: 'v2s1',
        stagedAt: '',
        publishAt: row('ep2-s1').scheduled_at,
        delays: [],
      },
    };
    events.refuse = 'YouTube said no';

    const result = await saveCadenceAndReplan(db.client, actor, RULES, {
      now: NOW,
    });

    expect(result.ok && result.data.replan!.notMoved).toEqual([
      {
        publishId: 'ep2-s1',
        reason: 'Ep 2 · Two YouTube Short: YouTube said no',
      },
    ]);
    expect(istOf(row('ep2-s1').scheduled_at)).toBe('2026-11-03 11:00');
    expect(istOf(row('ep2-s2').scheduled_at)).not.toBe('2026-11-03 17:00');
  });

  it('replan_schedule lays a project’s channels again, the same plan as a save', async () => {
    db.tables.channel_posting_cadences!.splice(
      1,
      1,
      cadenceRow(YT, 'short', {
        slot_times: RULES.slotTimes,
        start_after_hours: 1,
      }) as unknown as Row,
    );

    const preview = await replanSchedule(
      db.client,
      actor,
      { projectId: 'project', dryRun: true },
      { now: NOW },
    );
    const applied = await replanSchedule(
      db.client,
      actor,
      { projectId: 'project', dryRun: false },
      { now: NOW },
    );

    expect(preview.ok && applied.ok).toBe(true);
    expect(preview.ok && preview.data.moves).toEqual(
      applied.ok && applied.data.moves,
    );
    expect(istOf(row('ep2-s1').scheduled_at)).toBe('2026-11-02 21:00');
  });
});
