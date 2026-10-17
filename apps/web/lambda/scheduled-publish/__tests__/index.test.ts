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
const sent: string[] = [];
const messages: Array<{ publishId: string; thumbnailUrl?: string }> = [];
const gateOutcomes = new Map<string, string>();

/** An in-memory `publishes`: selects see what updates left behind */
function from(table: string) {
  const filters: Array<[string, unknown]> = [];
  let update: Record<string, unknown> | null = null;

  const matching = () =>
    [...rows.values()].filter((row) =>
      filters.every(([column, value]) => row[column] === value),
    );

  const run = async () => {
    // Let other runs interleave, as two Lambdas would
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (table !== 'publishes') return { data: [], error: null };

    if (update) {
      const hit = matching();
      for (const row of hit) Object.assign(row, update);
      return { data: hit.map((row) => ({ id: row.id })), error: null };
    }

    return { data: matching().map((row) => ({ ...row })), error: null };
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
    lte: () => q,
    order: () => q,
    limit: () => q,
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
    scheduled_at: '2026-11-05T12:00:00Z',
    slot_at: '2026-11-05T12:00:00Z',
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
  rows.clear();
  sent.length = 0;
  messages.length = 0;
  gateOutcomes.clear();
});

describe('the scheduled job', () => {
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
});
