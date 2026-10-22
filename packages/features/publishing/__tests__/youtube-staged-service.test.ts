import type { SupabaseClient } from '@supabase/supabase-js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@kit/supabase/database';

/**
 * KB-214. A breaking release moves the Shorts queued behind it; one already
 * uploaded to YouTube ahead of its time must move there too, or YouTube
 * publishes it at the old time.
 */

vi.mock('server-only', () => ({}));
vi.mock('../src/server/connection-tokens', () => ({
  getAccessToken: async () => ({ accessToken: 'token' }),
}));

const youtube = vi.hoisted(() => ({
  moved: [] as string[],
  refuse: null as string | null,
}));
vi.mock('../src/providers/youtube/youtube-provider', () => ({
  YouTubeProvider: class {
    async updatePublishAt(videoId: string, publishAt: string) {
      if (youtube.refuse) throw new Error(youtube.refuse);
      youtube.moved.push(`${videoId} ${publishAt}`);
      return 'set';
    }
  },
}));

const NOW = new Date('2026-11-05T12:00:00Z');
let rows: Array<Record<string, unknown>>;
const updates: Array<Record<string, unknown>> = [];

function from() {
  const q = {
    select: () => q,
    in: () => q,
    eq: () => q,
    not: () => Promise.resolve({ data: rows, error: null }),
    update: (values: Record<string, unknown>) => {
      updates.push(values);
      return { eq: () => ({ eq: async () => ({ error: null }) }) };
    },
  };
  return q;
}

const client = { from } as unknown as SupabaseClient<Database>;

const staged = (scheduledAt: string, publishAt: string) => ({
  id: 'p1',
  platform: 'youtube',
  platform_connection_id: 'yt',
  status: 'scheduled',
  scheduled_at: scheduledAt,
  metadata: {
    youtube: { videoId: 'v1', stagedAt: '', publishAt, delays: [] },
  },
});

beforeEach(() => {
  youtube.moved.length = 0;
  youtube.refuse = null;
  updates.length = 0;
});

async function sync() {
  const { syncStagedPublishTimes } = await import(
    '../src/server/youtube-staged.service'
  );
  return syncStagedPublishTimes(client, ['p1'], NOW);
}

describe('a moved staged post moves on YouTube (KB-214)', () => {
  it('sets YouTube’s publish time to the post’s new time', async () => {
    rows = [staged('2026-11-05T15:00:00.000Z', '2026-11-05T13:00:00.000Z')];

    expect(await sync()).toEqual([]);
    expect(youtube.moved).toEqual(['v1 2026-11-05T15:00:00.000Z']);
    expect(updates[0]).toMatchObject({
      metadata: { youtube: { publishAt: '2026-11-05T15:00:00.000Z' } },
    });
  });

  it('leaves alone a post whose time did not move', async () => {
    rows = [staged('2026-11-05T13:00:00.000Z', '2026-11-05T13:00:00.000Z')];

    await sync();

    expect(youtube.moved).toEqual([]);
  });

  it('returns YouTube’s refusal', async () => {
    rows = [staged('2026-11-05T15:00:00.000Z', '2026-11-05T13:00:00.000Z')];
    youtube.refuse = 'YouTube refused to move the video’s publish time: quota';

    expect(await sync()).toEqual([
      'YouTube refused to move the video’s publish time: quota',
    ]);
  });
});
