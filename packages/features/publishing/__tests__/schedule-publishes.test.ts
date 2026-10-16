import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduleTarget } from '../src/server/schedule-publishes.service';

/**
 * Scheduling over MCP (owner, 2026-10-10): every target is checked before a
 * row is written, as the Publish screen checks it, and a scheduled publish
 * is cancelled only while it is still scheduled, by an owner or admin.
 */

vi.mock('server-only', () => ({}));
vi.mock('../src/lib/x-switch', () => ({ X_ENABLED: false }));
// The team's and the project's channels: their own tests' subject
vi.mock('../src/server/connection-account', () => ({
  assertConnectionOfAccount: async () => undefined,
}));
vi.mock('../src/server/project-channels', () => ({
  assertConnectionOfProject: async () => undefined,
}));

const getAccessToken = vi.fn();
vi.mock('../src/server/connection-tokens', () => ({
  getAccessToken: (id: string) => getAccessToken(id),
}));

const EPISODE = '00000000-0000-4000-8000-0000000000e1';
const YT = '00000000-0000-4000-8000-0000000000c1';
const IG = '00000000-0000-4000-8000-0000000000c2';
const VIDEO = `https://abcdefghijklmnop.supabase.co/storage/v1/object/public/project-assets/episodes/${EPISODE}/videos/en-1.mp4`;
const NOW = new Date('2026-10-10T12:00:00Z');
const LATER = '2026-10-11T12:00:00.000Z';

const inserted: Array<Record<string, unknown>> = [];
const deleted: string[] = [];
let publishRow: { status: string } | null;
/** The row's status when the delete runs; the scheduled job may have moved it */
let statusAtDelete: string;
let role: string | null;

function query(name: string) {
  let filters: Record<string, unknown> = {};
  let insertRows: Array<Record<string, unknown>> | null = null;
  let deleting = false;

  const q = {
    select: () => q,
    eq: (column: string, value: unknown) => {
      filters = { ...filters, [column]: value };
      return q;
    },
    in: () => {
      if (name === 'platform_connections') {
        return Promise.resolve({
          data: [
            {
              id: YT,
              platform: 'youtube',
              language: 'en',
              platform_account_name: 'Story YT',
              youtube_made_for_kids: false,
              youtube_category_id: '22',
            },
            {
              id: IG,
              platform: 'instagram',
              language: 'en',
              platform_account_name: 'Story IG',
            },
          ],
          error: null,
        });
      }
      return q;
    },
    insert: (rows: Array<Record<string, unknown>>) => {
      insertRows = rows;
      return q;
    },
    delete: () => {
      deleting = true;
      return q;
    },
    single: () =>
      Promise.resolve({
        data: {
          final_video_url: null,
          thumbnail_url: null,
          project_id: 'p1',
          project: { account_id: 'a1' },
          localized_videos: { en: VIDEO },
          shorts_groups: [
            {
              id: 'ig-cut',
              name: 'IG cut',
              platforms: ['instagram'],
              videos: { en: VIDEO },
            },
          ],
          public_slug: null,
          title: 'Pilot',
          number: 1,
        },
        error: null,
      }),
    maybeSingle: () => {
      if (name === 'project_members') {
        return Promise.resolve({ data: role ? { role } : null, error: null });
      }
      return Promise.resolve({
        data: publishRow
          ? {
              id: 'pub-1',
              episode_id: EPISODE,
              status: publishRow.status,
              episodes: { project_id: 'p1' },
            }
          : null,
        error: null,
      });
    },
    then: (resolve: (value: unknown) => void) => {
      if (insertRows) {
        inserted.push(...insertRows);
        return resolve({
          data: insertRows.map((row, index) => ({
            id: `pub-${index + 1}`,
            ...row,
          })),
          error: null,
        });
      }
      if (deleting) {
        const hit =
          !!publishRow &&
          (filters.status === undefined || filters.status === statusAtDelete);
        if (hit) deleted.push(String(filters.id));
        return resolve({ data: hit ? [{ id: filters.id }] : [], error: null });
      }
      return resolve({ data: null, error: null });
    },
  };
  return q;
}

const client = { from: (name: string) => query(name) } as never;

function target(overrides: Partial<ScheduleTarget> = {}): ScheduleTarget {
  return {
    connectionId: YT,
    contentType: 'full',
    title: 'Pilot',
    description: '',
    tags: [],
    scheduledAt: LATER,
    platformSpecific: {},
    ...overrides,
  };
}

async function schedule(targets: ScheduleTarget[]) {
  const { schedulePublishes } = await import(
    '../src/server/schedule-publishes.service'
  );
  return schedulePublishes(client, 'user-1', {
    episodeId: EPISODE,
    targets,
    aiGenerated: false,
    now: NOW,
  });
}

beforeEach(() => {
  inserted.length = 0;
  deleted.length = 0;
  publishRow = { status: 'scheduled' };
  statusAtDelete = 'scheduled';
  role = 'owner';
  getAccessToken.mockReset();
  getAccessToken.mockResolvedValue({ accessToken: 'token' });
});

describe('scheduling a publish over MCP', () => {
  it('writes one scheduled row per target, on the channel’s own platform', async () => {
    const result = await schedule([
      target(),
      target({
        connectionId: IG,
        contentType: 'short',
        shortsGroupId: 'ig-cut',
      }),
    ]);

    expect(result.ok).toBe(true);
    expect(inserted).toEqual([
      expect.objectContaining({
        platform: 'youtube',
        content_type: 'full',
        status: 'scheduled',
        scheduled_at: LATER,
        language: 'en',
        metadata: expect.objectContaining({
          createdVia: 'mcp',
          createdBy: 'user-1',
          madeForKids: false,
        }),
      }),
      expect.objectContaining({
        platform: 'instagram',
        content_type: 'short',
        status: 'scheduled',
        metadata: expect.objectContaining({ shortsGroupId: 'ig-cut' }),
      }),
    ]);
  });

  it.each([
    [
      'a time that has passed',
      [target({ scheduledAt: '2026-10-10T11:59:00.000Z' })],
      'must be in the future',
    ],
    [
      'a Shorts group sent to a platform it does not go to',
      [target(), target({ contentType: 'short', shortsGroupId: 'ig-cut' })],
      'The Shorts group "IG cut" isn\'t set to go to YouTube.',
    ],
    [
      'a short with no group',
      [target({ connectionId: IG, contentType: 'short' })],
      'A short names its Shorts group',
    ],
    [
      'a language the episode has no video in',
      [target({ language: 'hi' })],
      'This episode has no hi video',
    ],
  ])('refuses %s, and writes nothing', async (_, targets, refusal) => {
    const result = await schedule(targets);

    expect(result).toEqual({
      ok: false,
      refusal: expect.stringContaining(refusal),
    });
    expect(inserted).toHaveLength(0);
  });

  it('refuses a channel that can no longer be published to, and writes nothing', async () => {
    getAccessToken.mockResolvedValue({ error: 'CONNECTION_INACTIVE' });

    const result = await schedule([target()]);

    expect(result.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });
});

describe('cancelling a scheduled publish', () => {
  async function cancel() {
    const { cancelScheduledPublish } = await import(
      '../src/server/schedule-publishes.service'
    );
    return cancelScheduledPublish(client, 'user-1', 'pub-1');
  }

  it('deletes it while it is still scheduled', async () => {
    expect(await cancel()).toEqual({
      ok: true,
      data: { publishId: 'pub-1', episodeId: EPISODE },
    });
    expect(deleted).toEqual(['pub-1']);
  });

  it('refuses one that has started or gone out', async () => {
    publishRow = { status: 'published' };

    expect(await cancel()).toEqual({
      ok: false,
      refusal: expect.stringContaining('published, not scheduled'),
    });
    expect(deleted).toHaveLength(0);
  });

  it('refuses one the scheduled job claimed after it was read, and deletes nothing', async () => {
    statusAtDelete = 'queued';

    expect(await cancel()).toEqual({
      ok: false,
      refusal:
        'That publish started just now, so it can no longer be cancelled.',
    });
    expect(deleted).toHaveLength(0);
  });

  it('refuses a project member who is not an owner or admin', async () => {
    role = 'member';

    expect(await cancel()).toEqual({
      ok: false,
      refusal: 'Only project owners and admins can cancel a scheduled publish.',
    });
    expect(deleted).toHaveLength(0);
  });
});
