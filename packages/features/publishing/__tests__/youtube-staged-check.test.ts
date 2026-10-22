import type { SupabaseClient } from '@supabase/supabase-js';

import { beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '@kit/supabase/database';

import {
  type YouTubeStagingApi,
  checkStagedYouTube,
} from '../src/lib/youtube-staged-check';
import type { YouTubeReadiness } from '../src/lib/youtube-staging';

/**
 * KB-214. The scheduled job's look, every five minutes, at a channel's
 * YouTube uploads made ahead of their time: what went public, what YouTube
 * rejected, what moved, what was cancelled with its episode, and the HD
 * gate that keeps a video private until YouTube has made it HD.
 *
 * Against an in-memory `publishes` and a stand-in YouTube.
 */

type Row = Record<string, unknown> & { id: string };

const rows = new Map<string, Row>();

function from(table: string) {
  const eqs: Array<[string, unknown]> = [];
  const ins: Array<[string, unknown[]]> = [];
  const notNull: string[] = [];
  let update: Record<string, unknown> | null = null;
  let remove = false;
  let window: [number, number] | null = null;

  const valueAt = (row: Row, path: string) => {
    const [column, ...keys] = path.split('->');
    let value: unknown = row[column!];
    for (const key of keys) {
      value = (value as Record<string, unknown> | null)?.[key];
    }
    return value;
  };

  const matching = () =>
    table !== 'publishes'
      ? []
      : [...rows.values()].filter(
          (row) =>
            eqs.every(([c, v]) => row[c] === v) &&
            ins.every(([c, list]) => list.includes(row[c])) &&
            notNull.every((path) => valueAt(row, path) != null),
        );

  const run = () => {
    const hit = matching();
    if (remove) for (const row of hit) rows.delete(row.id);
    if (update) for (const row of hit) Object.assign(row, update);
    const found = hit.map((row) => structuredClone(row));
    return {
      data: window ? found.slice(window[0], window[1] + 1) : found,
      error: null,
    };
  };

  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => (eqs.push([c, v]), q),
    in: (c: string, list: unknown[]) => (ins.push([c, list]), q),
    not: (path: string) => (notNull.push(path), q),
    order: () => q,
    range: (start: number, end: number) => ((window = [start, end]), q),
    update: (values: Record<string, unknown>) => ((update = values), q),
    delete: () => ((remove = true), q),
    then: (resolve: (value: unknown) => unknown) => resolve(run()),
  };

  return q;
}

const client = { from } as unknown as SupabaseClient<Database>;

const NOW = new Date('2026-11-05T12:00:00Z');
const at = (minutes: number) =>
  new Date(NOW.getTime() + minutes * 60_000).toISOString();

let videos: Map<string, YouTubeReadiness>;
const calls: string[] = [];

const api: YouTubeStagingApi = {
  readiness: async (ids) =>
    new Map(
      ids.flatMap((id) => (videos.has(id) ? [[id, videos.get(id)!]] : [])),
    ),
  updatePublishAt: async (id, publishAt) => {
    calls.push(`publishAt ${id} ${publishAt}`);
    return 'set';
  },
  makePublic: async (id) => {
    calls.push(`public ${id}`);
    return 'set';
  },
  deleteVideo: async (id) => {
    calls.push(`delete ${id}`);
    return 'deleted';
  },
};

const video = (
  definition: string,
  processingStatus: string,
  status: Record<string, unknown> = {},
): YouTubeReadiness => ({
  status: { privacyStatus: 'private', uploadStatus: 'uploaded', ...status },
  processingDetails: { processingStatus },
  contentDetails: { definition },
});

function staged(
  id: string,
  publishAtMinutes: number,
  extra: Record<string, unknown> = {},
  youtube: Record<string, unknown> = {},
): Row {
  return {
    id,
    episode_id: 'ep1',
    platform_connection_id: 'yt',
    platform: 'youtube',
    status: 'scheduled',
    content_type: 'full',
    after_episode_full: false,
    scheduled_at: at(publishAtMinutes),
    slot_at: at(publishAtMinutes),
    metadata: {
      createdBy: 'u1',
      youtube: {
        videoId: `v-${id}`,
        stagedAt: at(-110),
        publishAt: at(publishAtMinutes),
        delays: [],
        ...youtube,
      },
    },
    episodes: { deleted_at: null },
    ...extra,
  };
}

const youtubeOf = (id: string) =>
  (rows.get(id)!.metadata as { youtube: Record<string, unknown> }).youtube;

const check = () => checkStagedYouTube(client, 'yt', api, NOW);

beforeEach(() => {
  rows.clear();
  videos = new Map();
  calls.length = 0;
});

describe('the HD gate (KB-214)', () => {
  it('moves a video still in SD ten minutes on, on YouTube and in the schedule', async () => {
    rows.set('p1', staged('p1', 8));
    videos.set('v-p1', video('sd', 'succeeded'));

    const result = await check();

    expect(calls).toEqual([`publishAt v-p1 ${at(18)}`]);
    expect(rows.get('p1')!.scheduled_at).toBe(at(18));
    expect(rows.get('p1')!.status).toBe('scheduled');
    expect(youtubeOf('p1')).toMatchObject({
      publishAt: at(18),
      delays: [
        {
          at: NOW.toISOString(),
          from: at(8),
          to: at(18),
          reason: 'hd_not_ready',
        },
      ],
    });
    expect(result.held).toBe(1);
  });

  it('holds a video still processing, with that reason', async () => {
    rows.set('p1', staged('p1', 5));
    videos.set('v-p1', video('sd', 'processing'));

    await check();

    expect(youtubeOf('p1').delays).toMatchObject([{ reason: 'processing' }]);
  });

  it('leaves a video processed in HD to go public at its time', async () => {
    rows.set('p1', staged('p1', 8));
    videos.set('v-p1', video('hd', 'succeeded'));

    await check();

    expect(calls).toEqual([]);
    expect(rows.get('p1')!.scheduled_at).toBe(at(8));
  });

  it('asks nothing of a video more than ten minutes from its time', async () => {
    rows.set('p1', staged('p1', 30));
    videos.set('v-p1', video('sd', 'processing'));

    await check();

    expect(calls).toEqual([]);
  });

  it('flags a video held six hours in all, and still holds it', async () => {
    const delays = Array.from({ length: 35 }, (_, n) => ({
      at: at(-360 + n * 10),
      from: at(-350 + n * 10 - 10),
      to: at(-350 + n * 10),
      reason: 'hd_not_ready',
    }));
    rows.set('p1', staged('p1', 5, {}, { delays }));
    videos.set('v-p1', video('sd', 'succeeded'));

    await check();

    expect(youtubeOf('p1').alert).toBe('held_over_6h');
    expect(rows.get('p1')!.status).toBe('scheduled');
  });

  it('holds a Short until its long video is public', async () => {
    rows.set(
      'short',
      staged('short', 5, { content_type: 'short', after_episode_full: true }),
    );
    rows.set('long', { ...staged('long', 0), status: 'scheduled' });
    videos.set('v-short', video('hd', 'succeeded'));
    videos.set('v-long', video('sd', 'processing'));

    await check();

    expect(youtubeOf('short').delays).toMatchObject([
      { reason: 'waiting_for_long_video' },
    ]);
  });
});

describe('what YouTube did with a staged upload (KB-214)', () => {
  it('fails a rejected upload early, with YouTube’s reason', async () => {
    rows.set('p1', staged('p1', 90));
    videos.set(
      'v-p1',
      video('sd', 'failed', {
        uploadStatus: 'rejected',
        rejectionReason: 'length',
      }),
    );

    await check();

    expect(rows.get('p1')).toMatchObject({
      status: 'failed',
      metadata: {
        error: expect.stringContaining('rejectionReason: length'),
        errorCode: 'YOUTUBE_PROCESSING_FAILED',
      },
    });
  });

  it('marks one YouTube made public published, at its publish time', async () => {
    rows.set('p1', staged('p1', -3));
    videos.set('v-p1', video('hd', 'succeeded', { privacyStatus: 'public' }));

    await check();

    expect(rows.get('p1')).toMatchObject({
      status: 'published',
      published_at: at(-3),
    });
    expect(youtubeOf('p1').wentPublicAt).toBe(NOW.toISOString());
  });

  it('fails one deleted on YouTube before going public', async () => {
    rows.set('p1', staged('p1', 30));

    await check();

    expect(rows.get('p1')).toMatchObject({
      status: 'failed',
      metadata: { error: 'Deleted on YouTube before going public.' },
    });
  });

  it('moves YouTube’s time when the post was moved here', async () => {
    rows.set('p1', { ...staged('p1', 60), scheduled_at: at(90) });
    videos.set('v-p1', video('sd', 'processing'));

    await check();

    expect(calls).toEqual([`publishAt v-p1 ${at(90)}`]);
    expect(youtubeOf('p1').publishAt).toBe(at(90));
  });

  it('deletes on YouTube the upload of a post cancelled with its episode', async () => {
    rows.set('p1', {
      ...staged('p1', 60, {}, { orphanedAt: at(-1) }),
      status: 'deleting',
    });
    rows.set('p2', {
      ...staged('p2', 60),
      episodes: { deleted_at: at(-1) },
    });

    const result = await check();

    expect(calls).toEqual(['delete v-p1', 'delete v-p2']);
    expect(rows.has('p1')).toBe(false);
    expect(rows.has('p2')).toBe(false);
    expect(result.deleted).toBe(2);
  });

  it('keeps the post and returns YouTube’s refusal', async () => {
    rows.set('p1', staged('p1', 5));
    videos.set('v-p1', video('sd', 'succeeded'));
    const refusing: YouTubeStagingApi = {
      ...api,
      updatePublishAt: async () => {
        throw new Error(
          "YouTube refused to move the video's publish time: quota",
        );
      },
    };

    const result = await checkStagedYouTube(client, 'yt', refusing, NOW);

    expect(result.errors).toEqual([
      "p1: YouTube refused to move the video's publish time: quota",
    ]);
    expect(youtubeOf('p1').error).toMatch(/quota/);
    expect(rows.get('p1')!.status).toBe('scheduled');
  });
});

describe('a breaking post (KB-214, owner 2026-10-22)', () => {
  const breaking = (id: string) =>
    staged(id, -4, { release_priority: 'breaking' }, { goLiveWhenReady: true });

  it('stays private while YouTube has no HD', async () => {
    rows.set('b1', breaking('b1'));
    videos.set('v-b1', video('sd', 'processing'));

    await check();

    expect(calls).toEqual([]);
    expect(rows.get('b1')!.status).toBe('scheduled');
  });

  it('goes public the run YouTube has HD, and is published then', async () => {
    rows.set('b1', breaking('b1'));
    videos.set('v-b1', video('hd', 'succeeded'));

    const result = await check();

    expect(calls).toEqual(['public v-b1']);
    expect(rows.get('b1')).toMatchObject({
      status: 'published',
      published_at: NOW.toISOString(),
    });
    expect(result.madePublic).toBe(1);
  });

  it('is flagged six hours after its upload, and still waits', async () => {
    rows.set('b1', {
      ...breaking('b1'),
      metadata: {
        youtube: {
          videoId: 'v-b1',
          stagedAt: at(-361),
          publishAt: at(-361),
          delays: [],
          goLiveWhenReady: true,
        },
      },
    });
    videos.set('v-b1', video('sd', 'processing'));

    await check();

    expect(youtubeOf('b1').alert).toBe('held_over_6h');
    expect(rows.get('b1')!.status).toBe('scheduled');
  });
});
