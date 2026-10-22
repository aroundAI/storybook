import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-719. The scheduled job sends each due post once, and only when the
 * cadence rules let it go: two runs that overlap cannot both claim a row, a
 * Short waiting for its long video stays scheduled, and a post moved to
 * another day is not sent.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.PUBLISH_QUEUE_URL =
    'https://sqs.us-east-1.amazonaws.com/000000000000/publish';
});

interface Row {
  id: string;
  status: string;
  [column: string]: unknown;
}

const rows = new Map<string, Row>();
/** `platform_connections`, by id: only their metadata is read (KB-213) */
const connections = new Map<string, { id: string; metadata: unknown }>();
const sent: string[] = [];
/** KB-214: channels whose staged uploads the worker was asked to check */
const checks: string[] = [];
const messages: Array<{
  type?: string;
  publishId: string;
  thumbnailUrl?: string;
  staged?: { publishAt: string; goLiveWhenReady?: boolean };
  platformConnectionId?: string;
}> = [];
const gateOutcomes = new Map<string, string>();

/** An in-memory `publishes`: selects see what updates left behind */
function from(table: string) {
  const filters: Array<[string, unknown]> = [];
  const lists: Array<[string, unknown[]]> = [];
  const nulls: string[] = [];
  /** KB-214: `metadata->youtube` null or not */
  const jsonNull: Array<[string, boolean]> = [];
  const times: Array<[string, 'lte' | 'gt', string]> = [];
  let update: Record<string, unknown> | null = null;
  let window: [number, number] | null = null;

  const matching = () =>
    [...rows.values()].filter(
      (row) =>
        filters.every(([column, value]) => row[column] === value) &&
        // `.is('episodes.deleted_at', null)` on the embedded episode
        nulls.every((path) => {
          const [embed, column] = path.split('.') as [string, string];
          const parent = row[embed] as Record<string, unknown> | undefined;
          return (parent?.[column] ?? null) === null;
        }) &&
        lists.every(([column, values]) => values.includes(row[column])) &&
        jsonNull.every(([path, isNull]) => {
          const [column, key] = path.split('->') as [string, string];
          const value = (row[column] as Record<string, unknown> | null)?.[key];
          return (value == null) === isNull;
        }) &&
        times.every(([column, op, at]) => {
          const value = row[column];
          if (typeof value !== 'string') return false;
          return op === 'lte' ? value <= at : value > at;
        }),
    );

  const run = async () => {
    // Let other runs interleave, as two Lambdas would
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (table === 'platform_connections') {
      return {
        data: [...connections.values()].filter((row) =>
          lists.every(([column, values]) =>
            values.includes((row as Record<string, unknown>)[column]),
          ),
        ),
        error: null,
      };
    }

    if (table !== 'publishes') return { data: [], error: null };

    if (update) {
      const hit = matching();
      for (const row of hit) Object.assign(row, update);
      return { data: hit.map((row) => ({ id: row.id })), error: null };
    }

    const found = matching().map((row) => ({ ...row }));
    return {
      data: window ? found.slice(window[0], window[1] + 1) : found,
      error: null,
    };
  };

  const q = {
    select: () => q,
    update: (values: Record<string, unknown>) => {
      update = values;
      return q;
    },
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return q;
    },
    in: (column: string, values: unknown[]) => {
      lists.push([column, values]);
      return q;
    },
    is: (path: string, value: null) => {
      if (path.includes('->')) jsonNull.push([path, true]);
      else if (value === null) nulls.push(path);
      return q;
    },
    not: (path: string) => {
      jsonNull.push([path, false]);
      return q;
    },
    // ISO instants of one form compare as strings
    lte: (column: string, at: string) => {
      times.push([column, 'lte', new Date(at).toISOString()]);
      return q;
    },
    gt: (column: string, at: string) => {
      times.push([column, 'gt', new Date(at).toISOString()]);
      return q;
    },
    order: () => q,
    limit: () => q,
    range: (from: number, to: number) => {
      window = [from, to];
      return q;
    },
    overrideTypes: () => q,
    maybeSingle: async () => ({ data: { project_id: 'p1' }, error: null }),
    then: (resolve: (value: unknown) => unknown) => run().then(resolve),
  };

  return q;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from }),
}));

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: class {
    send(command: { input: { MessageBody: string } }) {
      const message = JSON.parse(command.input.MessageBody);
      if (message.type === 'youtube-staged-check') {
        checks.push(message.platformConnectionId);
        return Promise.resolve({});
      }
      sent.push(message.publishId);
      messages.push(message);
      return Promise.resolve({});
    }
  },
  SendMessageCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock('@kit/publishing/lib/episode-video', () => ({
  SCHEDULED_LAMBDA_PRECEDENCE: {},
  resolveEpisodeVideo: () => ({ url: 'https://cdn/video.mp4', from: 'full' }),
}));

vi.mock('@kit/publishing/lib/owned-episode-video', () => ({
  EPISODE_VIDEO_PUBLISH_REFUSAL: 'refused',
  ownedEpisodeVideo: async (url: string) => url,
}));

vi.mock('@kit/publishing/lib/cadence/gate', () => ({
  longVideoStates: async () => new Map(),
  cadenceGate: async (_client: unknown, publish: { id: string }) =>
    gateOutcomes.get(publish.id) ?? 'go',
}));

const { handler } = await import('../index');

function due(id: string): Row {
  return {
    id,
    status: 'scheduled',
    episode_id: 'ep1',
    platform_connection_id: 'yt',
    platform: 'youtube',
    title: 'A Short',
    description: '',
    tags: [],
    thumbnail_url: null,
    metadata: { shortsGroupId: 'g1', createdBy: 'u1' },
    content_type: 'short',
    language: 'en',
    ai_generated: false,
    scheduled_at: '2026-11-05T12:00:00.000Z',
    slot_at: '2026-11-05T12:00:00.000Z',
    after_episode_full: true,
    episodes: {
      project_id: 'p1',
      final_video_url: null,
      thumbnail_url: null,
      localized_videos: null,
      shorts_groups: null,
      projects: { account_id: 'a1' },
    },
  };
}

beforeEach(() => {
  // Every fixture is due at 12:00 on 5 Nov; the job runs five minutes later
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T12:05:00Z') });
  rows.clear();
  connections.clear();
  sent.length = 0;
  checks.length = 0;
  messages.length = 0;
  gateOutcomes.clear();
});

describe('the scheduled job', () => {
  // KB-206: a publish-now upload cut off mid-request stayed 'publishing'
  it('fails a publish left publishing for over 30 minutes', async () => {
    rows.set('stuck', {
      id: 'stuck',
      status: 'publishing',
      created_at: new Date(Date.now() - 45 * 60_000).toISOString(),
      metadata: null,
    });
    rows.set('running', {
      id: 'running',
      status: 'publishing',
      created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      metadata: null,
    });

    await handler();

    expect(rows.get('stuck')).toMatchObject({
      status: 'failed',
      metadata: {
        error: expect.stringMatching(
          /^Timed out while publishing; check the platform before retrying/,
        ),
      },
    });
    expect(rows.get('running')!.status).toBe('publishing');
    expect(sent).toEqual([]);
  });

  // KB-207: a deleted episode's scheduled long video was still posted
  it('does not send a post of a deleted episode', async () => {
    const row = due('gone');
    rows.set('gone', {
      ...row,
      content_type: 'full',
      episodes: {
        ...(row.episodes as object),
        deleted_at: '2026-10-19T08:00:00Z',
      },
    });
    rows.set('live', due('live'));

    await handler();

    expect(sent).toEqual(['live']);
    expect(rows.get('gone')!.status).toBe('scheduled');
  });

  it('sends a post once when two runs overlap', async () => {
    rows.set('p1', due('p1'));

    const results = await Promise.all([handler(), handler()]);

    expect(sent).toEqual(['p1']);
    expect(rows.get('p1')!.status).toBe('queued');
    expect(results.map((r) => r.queued).sort()).toEqual([0, 1]);
  });

  it('sends a Short no thumbnail and a long video the episode’s (KB-197)', async () => {
    const thumbnail = 'https://cdn/episodes/ep1/thumbnails/en-1.png';
    const withThumbnail = (id: string, contentType: string): Row => {
      const row = due(id);
      return {
        ...row,
        content_type: contentType,
        // A row written before KB-197 carries the episode's thumbnail too
        thumbnail_url: contentType === 'short' ? thumbnail : null,
        episodes: { ...(row.episodes as object), thumbnail_url: thumbnail },
      };
    };
    rows.set('long', withThumbnail('long', 'full'));
    rows.set('short', withThumbnail('short', 'short'));

    await handler();

    expect(
      Object.fromEntries(messages.map((m) => [m.publishId, m.thumbnailUrl])),
    ).toEqual({ long: thumbnail, short: undefined });
  });

  it('leaves a waiting Short scheduled and sends nothing for it', async () => {
    rows.set('p1', due('p1'));
    gateOutcomes.set('p1', 'waiting');

    const result = await handler();

    expect(sent).toEqual([]);
    expect(rows.get('p1')!.status).toBe('scheduled');
    expect(result.waiting).toBe(1);
  });

  it('does not send a post the cadence moved to another day', async () => {
    rows.set('p1', due('p1'));
    rows.set('p2', due('p2'));
    gateOutcomes.set('p2', 'deferred');

    const result = await handler();

    expect(sent).toEqual(['p1']);
    expect(result.deferred).toBe(1);
  });

  // KB-213: Meta's code 368 on the owner's Facebook Page; the job would
  // have kept sending that Page's posts into the block
  it('leaves a paused connection’s posts scheduled and sends the others', async () => {
    connections.set('fb', {
      id: 'fb',
      metadata: {
        publishBlock: {
          platform: 'facebook',
          code: 368,
          subcode: 4854002,
          message: 'Confirm your identity before you can publish as this Page.',
          at: '2026-10-20T00:31:00Z',
        },
      },
    });
    connections.set('yt', { id: 'yt', metadata: {} });
    rows.set('fb-short', {
      ...due('fb-short'),
      platform: 'facebook',
      platform_connection_id: 'fb',
    });
    rows.set('yt-short', due('yt-short'));

    const result = await handler();

    expect(sent).toEqual(['yt-short']);
    expect(rows.get('fb-short')!.status).toBe('scheduled');
    expect(result.paused).toBe(1);

    // Retry clears the block: the post goes at the next run
    connections.set('fb', { id: 'fb', metadata: {} });
    await handler();

    expect(sent).toEqual(['yt-short', 'fb-short']);
  });

  // KB-214: uploaded public at the slot, YouTube served 360p to launch viewers
  describe('YouTube posts uploaded ahead of their time (KB-214)', () => {
    const upcoming = (
      id: string,
      at: string,
      extra: Partial<Row> = {},
    ): Row => ({
      ...due(id),
      content_type: 'full',
      after_episode_full: false,
      scheduled_at: at,
      slot_at: at,
      ...extra,
    });

    it('uploads one due within the lead time, private until its slot', async () => {
      rows.set('soon', upcoming('soon', '2026-11-05T13:30:00.000Z'));
      rows.set('later', upcoming('later', '2026-11-05T15:00:00.000Z'));

      const result = await handler();

      expect(sent).toEqual(['soon']);
      expect(messages[0]!.staged).toEqual({
        publishAt: '2026-11-05T13:30:00.000Z',
      });
      expect(rows.get('soon')!.status).toBe('queued');
      expect(rows.get('later')!.status).toBe('scheduled');
      expect(result.staged).toBe(1);
    });

    it('uploads public, at its time, one due within two minutes', async () => {
      rows.set('now', upcoming('now', '2026-11-05T12:06:00.000Z'));

      await handler();
      expect(sent).toEqual([]);

      vi.setSystemTime(new Date('2026-11-05T12:10:00Z'));
      await handler();

      expect(sent).toEqual(['now']);
      expect(messages[0]!.staged).toBeUndefined();
    });

    it('honours the project’s lead time, and 0 turns it off', async () => {
      const withLead = (id: string, minutes: number): Row => {
        const row = upcoming(id, '2026-11-05T12:45:00.000Z');
        const episodes = row.episodes as Record<string, unknown>;
        return {
          ...row,
          episodes: {
            ...episodes,
            projects: {
              account_id: 'a1',
              metadata: { youtubeLeadMinutes: minutes },
            },
          },
        };
      };
      rows.set('short-lead', withLead('short-lead', 30));
      rows.set('off', withLead('off', 0));
      rows.set('long-lead', withLead('long-lead', 60));

      await handler();

      expect(sent).toEqual(['long-lead']);
    });

    it('never sends a staged upload again, and asks the worker to check its channel', async () => {
      rows.set(
        'staged',
        upcoming('staged', '2026-11-05T12:00:00.000Z', {
          metadata: {
            youtube: {
              videoId: 'v1',
              publishAt: '2026-11-05T12:00:00.000Z',
              delays: [],
            },
          },
        }),
      );

      await handler();
      await handler();

      expect(sent).toEqual([]);
      expect(rows.get('staged')!.status).toBe('scheduled');
      expect(checks).toEqual(['yt', 'yt']);
    });

    it('stages a post once when two runs overlap', async () => {
      rows.set('soon', upcoming('soon', '2026-11-05T13:00:00.000Z'));

      await Promise.all([handler(), handler()]);

      expect(sent).toEqual(['soon']);
    });

    // Owner, 2026-10-22: a breaking release waits for HD too
    it('uploads a due breaking post private, to go public once YouTube has HD', async () => {
      rows.set(
        'breaking',
        upcoming('breaking', '2026-11-05T12:01:00.000Z', {
          release_priority: 'breaking',
        }),
      );

      await handler();

      expect(sent).toEqual(['breaking']);
      expect(messages[0]!.staged).toEqual({
        publishAt: '2026-11-05T12:01:00.000Z',
        goLiveWhenReady: true,
      });
    });

    it('still uploads a due Facebook post as before', async () => {
      rows.set(
        'fb',
        upcoming('fb', '2026-11-05T12:00:00.000Z', {
          platform: 'facebook',
          release_priority: 'breaking',
        }),
      );

      await handler();

      expect(messages[0]!.staged).toBeUndefined();
    });
  });
});
