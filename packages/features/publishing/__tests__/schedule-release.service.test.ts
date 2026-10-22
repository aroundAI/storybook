import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionRefusal } from '@kit/next/action-result';

import type { ChannelCadenceRow } from '../src/lib/cadence/cadence';
import type { ScheduleTarget } from '../src/server/schedule-publishes.service';
import {
  previewBreakingRelease,
  previewCadenceRelease,
  requeueHeldShorts,
  scheduleBreakingRelease,
  scheduleCadenceRelease,
} from '../src/server/schedule-release.service';

/**
 * FILM-2209, FILM-2210. A cadence release and a breaking release end to
 * end through the service, on an in-memory PostgREST that keeps
 * `publishes_channel_slot_key` and runs reschedule_publishes all or
 * nothing: what it reads, what it writes, and what it never touches.
 * Preparing a row (the Publish screen's checks) is its own tests' subject.
 */

// KB-214: a moved post already on YouTube; youtube-staged-check.test.ts's subject
vi.mock('../src/server/youtube-staged.service', () => ({
  syncStagedPublishTimes: async () => [],
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/server/connection-tokens', () => ({
  getAccessToken: async () => 'token',
}));
const projectChannels = vi.hoisted(() => ({ outside: new Set<string>() }));
vi.mock('../src/server/project-channels', () => ({
  assertConnectionOfProject: async (
    _client: unknown,
    connectionIds: string[],
    projectId: string,
  ) => {
    if (projectId !== 'project') throw new Error(projectId);
    if (connectionIds.some((id) => projectChannels.outside.has(id))) {
      throw new ActionRefusal(
        "That channel isn't one of this project's channels.",
      );
    }
  },
}));
vi.mock('../src/server/publish-preflight', () => ({
  preparePublish: async () => undefined,
}));
vi.mock('../src/server/schedule-publishes.service', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../src/server/schedule-publishes.service')
    >();

  return {
    ...actual,
    prepareScheduledRows: async (
      _client: unknown,
      _userId: string,
      input: { episodeId: string; targets: ScheduleTarget[] },
    ) =>
      input.targets.map((target) => ({
        episode_id: input.episodeId,
        platform_connection_id: target.connectionId,
        platform: target.connectionId === IG ? 'instagram' : 'youtube',
        content_type: target.contentType,
        title: target.title,
        status: 'scheduled',
        scheduled_at: target.scheduledAt,
        slot_at: target.slotAt ?? null,
        after_episode_full: target.afterEpisodeFull ?? false,
        language: 'en',
        metadata: { shortsGroupId: target.shortsGroupId ?? null },
      })),
  };
});

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-11-02T03:30:00Z'); // 09:00 IST, Monday
const YT = '00000000-0000-4000-8000-0000000000c1';
const IG = '00000000-0000-4000-8000-0000000000c2';
const FB = '00000000-0000-4000-8000-0000000000c3';

type Row = Record<string, unknown> & { id: string };

const ON_CALENDAR = ['scheduled', 'queued', 'publishing', 'published'];

/** PostgREST over arrays, with the one unique index a release can hit */
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
        id: IG,
        account_id: 'team',
        platform: 'instagram',
        platform_account_name: 'Story IG',
      },
      {
        id: FB,
        account_id: 'team',
        platform: 'facebook',
        platform_account_name: 'Story FB',
      },
    ],
    channel_posting_cadences: [],
  };
  const writes: Array<{ table: string; op: string; ids: string[] }> = [];
  /** Error codes the next reschedule_publishes calls fail with, in order */
  const rpcFailures: string[] = [];
  let nextId = 1;

  const slotTaken = (row: Row, others: Row[]) =>
    !!row.slot_at &&
    ON_CALENDAR.includes(String(row.status)) &&
    others.some(
      (other) =>
        other.id !== row.id &&
        other.platform_connection_id === row.platform_connection_id &&
        other.slot_at === row.slot_at &&
        ON_CALENDAR.includes(String(other.status)),
    );

  const from = (table: string) => {
    if (table === 'episodes') {
      const episode = {
        select: () => episode,
        eq: () => episode,
        maybeSingle: async () => ({
          data: { project_id: 'project' },
          error: null,
        }),
      };
      return episode;
    }

    const filters: Array<(row: Row) => boolean> = [];
    let op: 'select' | 'update' | 'insert' = 'select';
    let values: Record<string, unknown> | Row[] = {};
    let range: [number, number] | null = null;

    const run = () => {
      if (op === 'insert') {
        const rows = (values as Row[]).map((row) => ({
          ...row,
          id: `pub-${nextId++}`,
        }));
        for (const row of rows) {
          if (slotTaken(row, [...tables[table]!, ...rows])) {
            return { data: null, error: { code: '23505', message: 'slot' } };
          }
        }
        tables[table]!.push(...rows);
        writes.push({ table, op, ids: rows.map((r) => r.id) });
        return { data: rows, error: null };
      }

      const rows = tables[table]!.filter((row) => filters.every((f) => f(row)));

      if (op === 'update') {
        for (const row of rows) {
          if (slotTaken({ ...row, ...values } as Row, tables[table]!)) {
            return { data: null, error: { code: '23505', message: 'slot' } };
          }
        }
        for (const row of rows) Object.assign(row, values);
        writes.push({ table, op, ids: rows.map((r) => r.id) });
        return { data: rows.map((r) => ({ id: r.id })), error: null };
      }

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
      insert: (rows: Row[]) => {
        op = 'insert';
        values = rows;
        return q;
      },
      update: (patch: Record<string, unknown>) => {
        op = 'update';
        values = patch;
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

  /** reschedule_publishes: every move and insert, or none */
  const rpc = async (
    name: string,
    args: {
      p_moves: Array<{ id: string; slot_at: string; scheduled_at: string }>;
      p_inserts: Row[];
    },
  ) => {
    if (name !== 'reschedule_publishes') throw new Error(name);

    const failure = rpcFailures.shift();
    if (failure)
      return { data: null, error: { code: failure, message: failure } };

    const publishes = tables.publishes!;
    const before = publishes.map((row) => ({ ...row }));
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
      }),
    );

    const inserted = args.p_inserts.map((row) => ({
      ...row,
      id: `pub-${nextId++}`,
      status: 'scheduled',
    }));
    publishes.push(...inserted);

    if (publishes.some((row) => slotTaken(row, publishes))) {
      undo();
      return { data: null, error: { code: '23505', message: 'slot' } };
    }

    writes.push({
      table: 'publishes',
      op: 'rpc',
      ids: [...moved.map((row) => row!.id), ...inserted.map((row) => row.id)],
    });
    return { data: inserted, error: null };
  };

  return {
    client: { from, rpc } as unknown as Parameters<
      typeof scheduleCadenceRelease
    >[0],
    tables,
    writes,
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

const release = (
  episodeId: string,
  shorts: number,
  connectionId = YT,
  withLong = true,
) => ({
  episodeId,
  notBefore: NOW.toISOString(),
  timezone: TZ,
  aiGenerated: false,
  targets: [
    ...(withLong
      ? [
          {
            key: `${episodeId}:full`,
            connectionId,
            contentType: 'full' as const,
            title: episodeId,
            description: '',
            tags: [],
            platformSpecific: {},
          },
        ]
      : []),
    ...Array.from({ length: shorts }, (_, i) => ({
      key: `${episodeId}:short:${i + 1}`,
      connectionId,
      contentType: 'short' as const,
      shortsGroupId: `${episodeId}-g${i + 1}`,
      title: `${episodeId} short ${i + 1}`,
      description: '',
      tags: [],
      platformSpecific: {},
    })),
  ],
});

const ist = (iso: unknown) =>
  new Date(String(iso)).toLocaleString('en-CA', {
    timeZone: TZ,
    hour12: false,
  });

let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
  projectChannels.outside.clear();
  db = fakeDb();
  db.tables.channel_posting_cadences!.push(
    cadenceRow(YT, 'full') as unknown as Row,
    cadenceRow(YT, 'short') as unknown as Row,
  );
});

const rowsOf = (episodeId: string, type?: string) =>
  db.tables
    .publishes!.filter(
      (row) =>
        row.episode_id === episodeId && (!type || row.content_type === type),
    )
    .sort((a, b) => String(a.slot_at).localeCompare(String(b.slot_at)));

describe('a cadence release through the service', () => {
  it('appends a later batch and never writes to an earlier episode’s posts', async () => {
    for (const ep of ['ep1', 'ep2', 'ep3', 'ep4']) {
      const result = await scheduleCadenceRelease(
        db.client,
        'u1',
        release(ep, 8),
        {
          now: NOW,
        },
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
    const firstBatch = db.tables.publishes!.map((row) => ({ ...row }));
    const firstIds = new Set(firstBatch.map((row) => row.id));

    const twoDaysLater = new Date(NOW.getTime() + 2 * 86_400_000);
    for (const row of db.tables.publishes!) {
      if (new Date(String(row.scheduled_at)) <= twoDaysLater) {
        row.status = 'published';
        row.published_at = row.scheduled_at;
      }
    }

    let last;
    for (const ep of ['ep5', 'ep6', 'ep7', 'ep8', 'ep9']) {
      last = await scheduleCadenceRelease(db.client, 'u1', release(ep, 8), {
        now: twoDaysLater,
      });
      expect(last.ok, JSON.stringify(last)).toBe(true);
    }

    // Nothing of the first batch was written to again
    expect(
      db.writes.filter((w) => w.ids.some((id) => firstIds.has(id))),
    ).toEqual([db.writes[0], db.writes[1], db.writes[2], db.writes[3]]);

    expect(ist(rowsOf('ep5', 'full')[0]!.slot_at)).toBe('2026-11-14, 20:00:00');
    expect(ist(rowsOf('ep5', 'short')[0]!.slot_at)).toBe(
      // after ep4's 8 Shorts, which end on the 18th
      '2026-11-19, 11:00:00',
    );

    // 8 Shorts an episode, 6 slots between long videos: the queue grows
    if (!last?.ok) throw new Error('release refused');
    expect(last.data.shortsQueue).toEqual([
      expect.objectContaining({
        connectionId: YT,
        name: 'Story YT',
        // 72, less the two that went out in the first two days
        queued: 70,
        runsAhead: true,
      }),
    ]);
    expect(last.data.shortsQueue[0]!.daysAhead).toBeGreaterThan(7);
  });

  it('places a long video beside a Short on the same slot time without the slot index refusing it', async () => {
    db.tables.channel_posting_cadences = [
      cadenceRow(YT, 'full', { slot_times: ['17:00'] }) as unknown as Row,
      cadenceRow(YT, 'short', { slot_times: ['17:00'] }) as unknown as Row,
    ];

    for (const ep of ['ep1', 'ep2']) {
      const result = await scheduleCadenceRelease(
        db.client,
        'u1',
        release(ep, 4),
        {
          now: NOW,
        },
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }

    const slots = db.tables.publishes!.map((row) => row.slot_at);
    expect(new Set(slots).size).toBe(slots.length);
    expect(rowsOf('ep2', 'full')).toHaveLength(1);
  });

  it('makes a YouTube Short wait for the YouTube long video, not the episode’s first anywhere', async () => {
    db.tables.channel_posting_cadences!.push(
      cadenceRow(FB, 'full') as unknown as Row,
    );
    // Episode 1 holds YouTube's next long-video slot; episode 2 went out on Facebook first
    await scheduleCadenceRelease(db.client, 'u1', release('ep1', 0), {
      now: NOW,
    });
    await scheduleCadenceRelease(db.client, 'u1', release('ep2', 0, FB), {
      now: NOW,
    });

    const result = await scheduleCadenceRelease(
      db.client,
      'u1',
      release('ep2', 1),
      { now: NOW },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const ytLong = rowsOf('ep2', 'full').find(
      (r) => r.platform_connection_id === YT,
    )!;
    const ytShort = rowsOf('ep2', 'short')[0]!;
    expect(ist(ytLong.slot_at)).toBe('2026-11-05, 20:00:00');
    expect(ist(ytShort.slot_at)).toBe('2026-11-06, 11:00:00');
  });

  it('refuses, saying why, an upload no slot in a year fits', async () => {
    db.tables.channel_posting_cadences = [
      cadenceRow(YT, 'short', {
        days_of_week: [1],
        every_n_days: 7,
      }) as unknown as Row,
    ];
    db.tables.publishes!.push({
      id: 'old',
      episode_id: 'ep0',
      platform_connection_id: YT,
      content_type: 'short',
      status: 'scheduled',
      slot_at: '2026-11-03T05:30:00.000Z', // a Tuesday
      scheduled_at: '2026-11-03T05:30:00.000Z',
    });

    const result = await previewCadenceRelease(
      db.client,
      release('ep1', 1, YT, false),
      { now: NOW },
    );

    expect(result).toEqual({
      ok: false,
      refusal: expect.stringContaining('No free slot in the next 365 days'),
    });
  });
});

// KB-199: a preview shows only posts scheduling would make; a channel
// outside the episode's project is refused there, as at preflight.
describe("a preview to a channel outside the episode's project", () => {
  it('is refused, for a cadence and for a breaking release', async () => {
    projectChannels.outside.add(YT);

    const cadence = await previewCadenceRelease(db.client, release('ep1', 1), {
      now: NOW,
    });
    const breaking = await previewBreakingRelease(
      db.client,
      { ...release('news', 1), breaking: {} },
      { now: NOW },
    );

    for (const result of [cadence, breaking]) {
      expect(result).toEqual({
        ok: false,
        refusal: "That channel isn't one of this project's channels.",
      });
    }
    expect(db.writes).toHaveLength(0);
  });
});

describe('Shorts an earlier release held (before FILM-2209)', () => {
  it('re-queues them at the end of their channel’s queue, and the next release leaves them there', async () => {
    await scheduleCadenceRelease(db.client, 'u1', release('ep1', 4), {
      now: NOW,
    });
    await scheduleCadenceRelease(db.client, 'u1', release('ep2', 2), {
      now: NOW,
    });

    // Two of episode 1's Shorts, held the old way
    const held = rowsOf('ep1', 'short').slice(0, 2);
    for (const row of held) {
      Object.assign(row, {
        status: 'draft',
        slot_at: null,
        scheduled_at: null,
        metadata: { heldReason: 'next-episode', heldBefore: '2026-11-05' },
      });
    }

    const requeued = await requeueHeldShorts(
      db.client,
      { publishIds: held.map((row) => row.id), timezone: TZ },
      { now: NOW },
    );
    expect(requeued).toEqual({
      ok: true,
      data: { requeued: held.map((row) => row.id) },
    });

    const lastBefore = rowsOf('ep2', 'short').at(-1)!.slot_at as string;
    for (const row of held) {
      expect(row.status).toBe('scheduled');
      expect(String(row.slot_at) > lastBefore).toBe(true);
      expect(row.metadata).toEqual({});
    }
    const after = held.map((row) => ({ ...row }));

    const next = await scheduleCadenceRelease(
      db.client,
      'u1',
      release('ep3', 2),
      {
        now: NOW,
      },
    );
    expect(next.ok).toBe(true);
    expect(held).toEqual(after);
    expect(
      rowsOf('ep3', 'short').every((row) =>
        held.every((h) => String(row.slot_at) > String(h.slot_at)),
      ),
    ).toBe(true);
  });
});

describe('FILM-2210: a breaking release through the service', () => {
  const sixEpisodes = async () => {
    for (const ep of ['ep1', 'ep2', 'ep3', 'ep4', 'ep5', 'ep6']) {
      const result = await scheduleCadenceRelease(
        db.client,
        'u1',
        release(ep, 4),
        { now: NOW },
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
    return db.tables.publishes!.map((row) => ({ ...row }));
  };

  const breakingRelease = (breaking = {}) => ({
    ...release('news', 6),
    breaking,
  });

  it('previews what would go and move, writing nothing', async () => {
    const before = await sixEpisodes();
    const writes = db.writes.length;

    const result = await previewBreakingRelease(db.client, breakingRelease(), {
      now: NOW,
    });
    if (!result.ok) throw new Error(result.refusal);

    expect(db.writes).toHaveLength(writes);
    expect(db.tables.publishes).toEqual(before);
    expect(result.data.placed).toHaveLength(7);
    expect(result.data.moves.length).toBeGreaterThan(0);
    expect(result.data.moves[0]).toMatchObject({
      name: 'Story YT',
      title: expect.stringContaining('short'),
    });
    expect(result.data.shortsQueue[0]!.after.queued).toBe(
      result.data.shortsQueue[0]!.before.queued + 6,
    );
  });

  it('writes the breaking posts and the moves in one call, and no long video moves', async () => {
    const before = await sixEpisodes();
    const result = await scheduleBreakingRelease(
      db.client,
      'u1',
      breakingRelease(),
      { now: NOW, random: () => 0.5 },
    );
    if (!result.ok) throw new Error(result.refusal);

    expect(db.writes.filter((w) => w.op === 'rpc')).toHaveLength(1);

    const long = rowsOf('news', 'full')[0]!;
    expect(long).toMatchObject({
      release_priority: 'breaking',
      slot_at: null,
      scheduled_at: new Date(NOW.getTime() + 60_000).toISOString(),
    });
    expect(rowsOf('news', 'short')).toHaveLength(6);
    expect(
      rowsOf('news', 'short').every(
        (row) => row.release_priority === 'breaking' && row.after_episode_full,
      ),
    ).toBe(true);

    for (const old of before.filter((row) => row.content_type === 'full')) {
      expect(db.tables.publishes!.find((r) => r.id === old.id)).toEqual(old);
    }

    const moved = before.filter((old) => {
      const now = db.tables.publishes!.find((r) => r.id === old.id)!;
      return now.slot_at !== old.slot_at;
    });
    expect(result.data.moves.map((m) => m.publishId).sort()).toEqual(
      moved.map((row) => row.id).sort(),
    );
    const firstBreaking = rowsOf('news', 'short')[0]!.slot_at as string;
    const lastBreaking = rowsOf('news', 'short').at(-1)!.slot_at as string;
    expect(ist(firstBreaking)).toBe('2026-11-02, 11:00:00');
    for (const row of moved) {
      const now = db.tables.publishes!.find((r) => r.id === row.id)!;
      expect(String(now.slot_at) > lastBreaking).toBe(true);
    }
  });

  it('plans again once when the calendar changed, then refuses', async () => {
    await sixEpisodes();
    db.rpcFailures.push('23505');
    const retried = await scheduleBreakingRelease(
      db.client,
      'u1',
      breakingRelease(),
      { now: NOW },
    );
    expect(retried.ok, JSON.stringify(retried)).toBe(true);

    db.rpcFailures.push('55000', '23505');
    const refused = await scheduleBreakingRelease(
      db.client,
      'u1',
      { ...release('news2', 1), breaking: {} },
      { now: NOW },
    );
    expect(refused).toEqual({
      ok: false,
      refusal: expect.stringContaining('calendar changed'),
    });
    expect(rowsOf('news2')).toEqual([]);
  });

  it('warns, without refusing, past 6 YouTube uploads in a Pacific day across the team', async () => {
    const YT2 = '00000000-0000-4000-8000-0000000000c4';
    db.tables.platform_connections!.push(
      {
        id: YT2,
        account_id: 'team',
        platform: 'youtube',
        platform_account_name: 'Second YT',
      },
      {
        id: 'other-team-yt',
        account_id: 'other',
        platform: 'youtube',
        platform_account_name: 'Not ours',
      },
    );
    // Pacific 2026-11-02 runs 08:00Z on the 2nd to 08:00Z on the 3rd
    const scheduledOn = (connectionId: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${connectionId}-${i}`,
        episode_id: 'elsewhere',
        platform_connection_id: connectionId,
        content_type: 'short',
        status: 'scheduled',
        slot_at: null,
        scheduled_at: new Date(
          Date.parse('2026-11-02T16:00:00Z') + i * 60_000,
        ).toISOString(),
      }));
    db.tables.publishes!.push(...scheduledOn('other-team-yt', 10));

    const quiet = await previewBreakingRelease(db.client, breakingRelease(), {
      now: NOW,
    });
    if (!quiet.ok) throw new Error(quiet.refusal);
    expect(quiet.data.quota).toEqual([]);

    db.tables.publishes!.push(...scheduledOn(YT2, 3));
    const busy = await previewBreakingRelease(db.client, breakingRelease(), {
      now: NOW,
    });
    if (!busy.ok) throw new Error(busy.refusal);

    expect(busy.data.quota).toEqual([
      { day: '2026-11-02', uploads: 7, limit: 6 },
    ]);

    // FILM-2212: the server's YOUTUBE_DAILY_UPLOAD_WARN moves the warning
    vi.stubEnv('YOUTUBE_DAILY_UPLOAD_WARN', '10');
    const granted = await previewBreakingRelease(db.client, breakingRelease(), {
      now: NOW,
    });
    vi.stubEnv('YOUTUBE_DAILY_UPLOAD_WARN', '4');
    const lower = await previewBreakingRelease(db.client, breakingRelease(), {
      now: NOW,
    });
    vi.unstubAllEnvs();
    if (!granted.ok) throw new Error(granted.refusal);
    if (!lower.ok) throw new Error(lower.refusal);

    expect(granted.data.quota).toEqual([]);
    expect(lower.data.quota).toEqual([
      { day: '2026-11-02', uploads: 7, limit: 4 },
    ]);
  });
});
