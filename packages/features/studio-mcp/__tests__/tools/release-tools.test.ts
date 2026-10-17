import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StorageAdapter } from '@kit/storage';

import { McpToolError } from '../../src/errors';
import type { McpToolDefinition } from '../../src/registry';
import { createEpisodeThumbnailTools } from '../../src/server/tools/author/episode-thumbnail';
import {
  discardHeldShortsTool,
  getChannelCadenceTool,
  getPublishCalendarTool,
  requeueHeldShortsTool,
  scheduleReleaseTool,
  setChannelCadenceTool,
} from '../../src/server/tools/publish/release';
import {
  type RecordedCall,
  createFakeClient,
  fakeContext,
} from '../helpers/fake-supabase';

/**
 * FILM-2208: a release on the channels' cadence, the cadence itself, held
 * Shorts, the calendar and the episode thumbnail, over MCP. Each tool calls
 * the function the Publish screen calls, so these tests hold the wiring and
 * the team scoping; the planner's rules are FILM-719's tests.
 */

const service = vi.hoisted(() => ({
  previewCadenceRelease: vi.fn(),
  scheduleCadenceRelease: vi.fn(),
  readChannelCadences: vi.fn(),
  saveChannelCadence: vi.fn(),
  requeueHeldShorts: vi.fn(),
  discardHeldShorts: vi.fn(),
  saveEpisodeThumbnail: vi.fn(),
}));

vi.mock('@kit/publishing/server/schedule-release', () => ({
  previewCadenceRelease: service.previewCadenceRelease,
  scheduleCadenceRelease: service.scheduleCadenceRelease,
  readChannelCadences: service.readChannelCadences,
  saveChannelCadence: service.saveChannelCadence,
  requeueHeldShorts: service.requeueHeldShorts,
  discardHeldShorts: service.discardHeldShorts,
}));

vi.mock('@kit/episodes/server/episode-thumbnail-service', () => ({
  saveEpisodeThumbnail: service.saveEpisodeThumbnail,
}));

vi.stubEnv('STORAGE_PROVIDER', 'r2');
vi.stubEnv(
  'R2_PUBLIC_URL',
  'https://pub-0123456789abcdef0123456789abcdef.r2.dev',
);

const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const OTHER_ACCOUNT = '99999999-9999-4999-8999-999999999999';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const EPISODE = '66666666-6666-4666-8666-666666666666';
const YT = '00000000-0000-4000-8000-0000000000c1';
const IG = '00000000-0000-4000-8000-0000000000c2';
const FOREIGN_CHANNEL = '00000000-0000-4000-8000-0000000000c9';
const THUMB_EN = 'https://cdn/episodes/e/thumbnails/en-1.png';
const THUMB_DEFAULT = 'https://cdn/episodes/e/thumbnails/hi-1.png';

function eqPairs(call: RecordedCall) {
  return call.filters
    .filter((f) => f.method === 'eq')
    .map((f) => f.args as [string, unknown]);
}

const CHANNELS = [
  {
    id: YT,
    account_id: ACCOUNT,
    platform: 'youtube',
    platform_account_name: 'Ledger YT',
    language: 'en',
  },
  {
    id: IG,
    account_id: ACCOUNT,
    platform: 'instagram',
    platform_account_name: 'Ledger IG',
    language: 'en',
  },
  {
    id: FOREIGN_CHANNEL,
    account_id: OTHER_ACCOUNT,
    platform: 'youtube',
    platform_account_name: 'Not ours',
    language: 'en',
  },
];

function client(
  options: {
    episodeInTeam?: boolean;
    thumbnails?: Array<{
      language: string;
      thumbnail_url: string;
      is_default: boolean;
    }>;
    publishes?: (call: RecordedCall) => { data: unknown };
  } = {},
) {
  return createFakeClient({
    episodes: () => ({
      data:
        options.episodeInTeam === false
          ? null
          : { id: EPISODE, project: { id: PROJECT, account_id: ACCOUNT } },
    }),
    projects: (call: RecordedCall) => ({
      data: eqPairs(call).some(
        ([column, value]) => column === 'account_id' && value !== ACCOUNT,
      )
        ? null
        : { id: PROJECT, account_id: ACCOUNT },
    }),
    platform_connections: (call: RecordedCall) => {
      const ids = (call.filters.find((f) => f.method === 'in')?.args[1] ??
        []) as string[];
      const account = eqPairs(call).find(([c]) => c === 'account_id')?.[1];
      return {
        data: CHANNELS.filter(
          (row) =>
            ids.includes(row.id) &&
            (account === undefined || row.account_id === account),
        ),
      };
    },
    episode_thumbnails: () => ({ data: options.thumbnails ?? [] }),
    publishes: options.publishes ?? (() => ({ data: [] })),
  });
}

const run = (
  tool: unknown,
  input: Record<string, unknown>,
  fake: ReturnType<typeof createFakeClient>,
) =>
  (tool as McpToolDefinition).handler(
    input as never,
    fakeContext(fake.client) as never,
  ) as Promise<{ text: string; structuredContent: Record<string, unknown> }>;

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof McpToolError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

const RELEASE = {
  episodeId: EPISODE,
  notBefore: '2026-10-18T00:00:00+05:30',
  timezone: 'Asia/Kolkata',
  preview: true,
  aiGenerated: false,
  targets: [
    {
      connectionId: YT,
      contentType: 'full',
      title: 'Fallen Unicorns',
      description: '',
      tags: [],
    },
    {
      connectionId: YT,
      contentType: 'short',
      shortsGroupId: 'yt-1',
      title: 'Short 1',
      description: '',
      tags: [],
    },
    {
      connectionId: IG,
      contentType: 'short',
      shortsGroupId: 'igfb-1',
      title: 'Reel 1',
      description: '',
      tags: [],
    },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
  service.previewCadenceRelease.mockResolvedValue({
    ok: true,
    data: {
      placed: [
        {
          key: 'target-0',
          connectionId: YT,
          contentType: 'full',
          scheduledAt: '2026-10-18T02:30:00.000Z',
        },
      ],
      held: [
        {
          key: 'target-2',
          connectionId: IG,
          reason: 'next-episode',
          before: null,
        },
      ],
      displaced: [],
      channels: [],
    },
  });
  service.scheduleCadenceRelease.mockResolvedValue({
    ok: true,
    data: { scheduled: [], held: [], displaced: [] },
  });
});

describe('schedule_release', () => {
  it('previews through the Publish screen’s planner and writes nothing', async () => {
    const result = await run(scheduleReleaseTool, RELEASE, client());

    expect(service.previewCadenceRelease).toHaveBeenCalledTimes(1);
    expect(service.scheduleCadenceRelease).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({
      preview: true,
      placed: [expect.objectContaining({ target: 0 })],
      held: [expect.objectContaining({ target: 2, reason: 'next-episode' })],
    });
  });

  it('schedules as the person, with a key per target and the times left to the cadence', async () => {
    await run(scheduleReleaseTool, { ...RELEASE, preview: false }, client());

    expect(service.previewCadenceRelease).not.toHaveBeenCalled();
    const [, userId, release] = service.scheduleCadenceRelease.mock.calls[0]!;
    expect(userId).toBe('11111111-1111-4111-8111-111111111111');
    expect(release).toMatchObject({
      episodeId: EPISODE,
      notBefore: '2026-10-17T18:30:00.000Z',
      timezone: 'Asia/Kolkata',
      aiGenerated: false,
    });
    expect(release.targets.map((t: { key: string }) => t.key)).toEqual([
      'target-0',
      'target-1',
      'target-2',
    ]);
    expect(release.targets[0]).not.toHaveProperty('scheduledAt');
  });

  it('gives the long video the episode thumbnail for its language and the Shorts none (KB-197)', async () => {
    await run(
      scheduleReleaseTool,
      { ...RELEASE, preview: false },
      client({
        thumbnails: [
          { language: 'hi', thumbnail_url: THUMB_DEFAULT, is_default: true },
          { language: 'en', thumbnail_url: THUMB_EN, is_default: false },
        ],
      }),
    );

    const [, , release] = service.scheduleCadenceRelease.mock.calls[0]!;
    expect(
      release.targets.map(
        (t: { thumbnailUrl: string | null }) => t.thumbnailUrl,
      ),
    ).toEqual([THUMB_EN, null, null]);
  });

  it('falls back to the default thumbnail when none is in the video’s language', async () => {
    await run(
      scheduleReleaseTool,
      { ...RELEASE, preview: false },
      client({
        thumbnails: [
          { language: 'hi', thumbnail_url: THUMB_DEFAULT, is_default: true },
        ],
      }),
    );

    const [, , release] = service.scheduleCadenceRelease.mock.calls[0]!;
    expect(release.targets[0].thumbnailUrl).toBe(THUMB_DEFAULT);
  });

  it('refuses an episode outside the team before planning anything', async () => {
    const error = await rejection(
      run(scheduleReleaseTool, RELEASE, client({ episodeInTeam: false })),
    );

    expect(error.code).toBe('NOT_FOUND');
    expect(service.previewCadenceRelease).not.toHaveBeenCalled();
  });

  it('returns the planner’s refusal as a validation failure', async () => {
    service.previewCadenceRelease.mockResolvedValue({
      ok: false,
      refusal: 'The Shorts group "IG cut" isn\'t set to go to YouTube.',
    });

    const error = await rejection(run(scheduleReleaseTool, RELEASE, client()));

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toContain('IG cut');
  });
});

describe('the channel cadence', () => {
  const CADENCE = {
    connectionId: YT,
    contentType: 'short',
    timezone: 'Asia/Kolkata',
    slotTimes: ['21:00', '11:00'],
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    minDaysBetween: 0,
    startAfterHours: 2,
    jitterMinutes: 15,
    enabled: true,
  };

  it('sets a channel of the team through the dialog’s save', async () => {
    service.saveChannelCadence.mockResolvedValue({
      ok: true,
      data: { connectionId: YT, contentType: 'short' },
    });

    await run(setChannelCadenceTool, CADENCE, client());

    expect(service.saveChannelCadence).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ connectionId: YT, startAfterHours: 2 }),
    );
  });

  it('refuses another team’s channel, even one the person can see', async () => {
    const error = await rejection(
      run(
        setChannelCadenceTool,
        { ...CADENCE, connectionId: FOREIGN_CHANNEL },
        client(),
      ),
    );

    expect(error.code).toBe('NOT_FOUND');
    expect(service.saveChannelCadence).not.toHaveBeenCalled();
  });

  it('refuses a posting time the dialog would refuse', async () => {
    const error = await rejection(
      run(
        setChannelCadenceTool,
        { ...CADENCE, slotTimes: ['25:00'] },
        client(),
      ),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toContain('18:00');
    expect(service.saveChannelCadence).not.toHaveBeenCalled();
  });

  it('reads each channel’s cadence with its name and platform', async () => {
    service.readChannelCadences.mockResolvedValue([
      {
        connectionId: YT,
        contentType: 'full',
        own: false,
        enabled: true,
        cadence: { slotTimes: ['17:00'] },
      },
    ]);

    const result = await run(
      getChannelCadenceTool,
      { connectionIds: [YT] },
      client(),
    );

    expect(result.structuredContent.cadences).toEqual([
      expect.objectContaining({ name: 'Ledger YT', platform: 'youtube' }),
    ]);
  });
});

describe('held Shorts', () => {
  const heldOf = (episodeInTeam: boolean) =>
    client({
      episodeInTeam,
      publishes: () => ({ data: [{ id: 'p1', episode_id: EPISODE }] }),
    });

  it.each([
    ['requeue_held_shorts', requeueHeldShortsTool, 'requeueHeldShorts'],
    ['discard_held_shorts', discardHeldShortsTool, 'discardHeldShorts'],
  ] as const)(
    '%s refuses a Short of another team’s episode',
    async (_name, tool, fn) => {
      const error = await rejection(
        run(
          tool,
          {
            publishIds: ['00000000-0000-4000-8000-0000000000a1'],
            timezone: 'UTC',
          },
          heldOf(false),
        ),
      );

      expect(error.code).toBe('NOT_FOUND');
      expect(service[fn]).not.toHaveBeenCalled();
    },
  );
});

describe('get_publish_calendar', () => {
  const row = (index: number, overrides: Record<string, unknown> = {}) => ({
    id: `p${String(index).padStart(5, '0')}`,
    episode_id: EPISODE,
    platform: 'youtube',
    platform_connection_id: YT,
    content_type: 'short',
    language: 'en',
    title: `Short ${index}`,
    status: 'scheduled',
    scheduled_at: new Date(Date.UTC(2026, 9, 18, 0, index)).toISOString(),
    slot_at: null,
    published_at: null,
    created_at: '2026-10-17T00:00:00Z',
    platform_url: null,
    metadata: {},
    episodes: { title: 'Fallen Unicorns', number: 2 },
    ...overrides,
  });

  const RANGE = {
    projectId: PROJECT,
    from: '2026-10-17T00:00:00Z',
    to: '2026-10-20T00:00:00Z',
  };

  it('reads past the 1000-row cap', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => row(i));
    const fake = client({
      publishes: (call) =>
        call.filters.some((f) => f.method === 'or')
          ? { data: rows }
          : { data: [] },
    });

    const result = await run(getPublishCalendarTool, RANGE, fake);

    expect((result.structuredContent.posts as unknown[]).length).toBe(1500);
  });

  it('names held Shorts and why a post failed, once each, in time order', async () => {
    const held = row(2, {
      status: 'draft',
      scheduled_at: null,
      metadata: { heldReason: 'next-episode' },
    });
    const failed = row(1, {
      status: 'failed',
      metadata: { error: 'quotaExceeded' },
    });
    const fake = client({
      publishes: (call) =>
        call.filters.some((f) => f.method === 'or')
          ? { data: [held, failed] }
          : { data: [held] },
    });

    const result = await run(getPublishCalendarTool, RANGE, fake);

    expect(result.structuredContent.posts).toEqual([
      expect.objectContaining({ status: 'failed', error: 'quotaExceeded' }),
      expect.objectContaining({ status: 'held', heldReason: 'next-episode' }),
    ]);
  });

  it('refuses a range longer than 62 days', async () => {
    const error = await rejection(
      run(
        getPublishCalendarTool,
        { ...RANGE, to: '2026-12-31T00:00:00Z' },
        client(),
      ),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
  });
});

describe('the episode thumbnail', () => {
  const KEY = `episodes/${EPISODE}/thumbnails/en-1790000000000.png`;
  const [request, finalize] = createEpisodeThumbnailTools({
    storage: () =>
      ({
        stat: async (_bucket: string, key: string) =>
          key === KEY ? { bytes: 1234 } : null,
        getPublicUrl: (_bucket: string, key: string) => `https://cdn/${key}`,
        getSignedUploadUrl: async () => ({
          uploadUrl: 'https://upload',
          headers: {},
          expiresIn: 3600,
        }),
      }) as unknown as StorageAdapter,
    now: () => 1790000000000,
  });

  const thumbnails = (defaultLanguage: string | null) =>
    createFakeClient({
      episodes: () => ({
        data: { id: EPISODE, project: { id: PROJECT, account_id: ACCOUNT } },
      }),
      episode_thumbnails: () => ({
        data: defaultLanguage ? { language: defaultLanguage } : null,
      }),
      'rpc:can_write_project_storage': () => ({ data: true }),
    });

  beforeEach(() => {
    service.saveEpisodeThumbnail.mockResolvedValue({ ok: true, thumbnail: {} });
  });

  it('signs an upload in the episode’s thumbnails folder', async () => {
    const result = await run(
      request,
      {
        episodeId: EPISODE,
        language: 'en',
        contentType: 'image/png',
        bytes: 1234,
      },
      thumbnails(null),
    );

    expect(result.structuredContent.key).toBe(KEY);
  });

  it('refuses a key outside this episode’s thumbnails', async () => {
    const error = await rejection(
      run(
        finalize,
        {
          episodeId: EPISODE,
          language: 'en',
          // As long as the folder, so only the folder check refuses it
          key: `episodes/${EPISODE}/videos/abcden-1.png`,
        },
        thumbnails(null),
      ),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(service.saveEpisodeThumbnail).not.toHaveBeenCalled();
  });

  it('refuses a key nothing was uploaded to', async () => {
    const error = await rejection(
      run(
        finalize,
        {
          episodeId: EPISODE,
          language: 'en',
          key: `episodes/${EPISODE}/thumbnails/en-1.png`,
        },
        thumbnails(null),
      ),
    );

    expect(error.message).toContain('No file was uploaded');
  });

  it.each([
    ['the first thumbnail becomes the default', null, true],
    ['finalizing the default language again keeps it the default', 'en', true],
    ['another language leaves the default where it is', 'hi', false],
  ])('%s', async (_label, defaultLanguage, isDefault) => {
    await run(
      finalize,
      { episodeId: EPISODE, language: 'en', key: KEY },
      thumbnails(defaultLanguage),
    );

    expect(service.saveEpisodeThumbnail).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        thumbnailUrl: `https://cdn/${KEY}`,
        isDefault,
      }),
    );
  });
});
