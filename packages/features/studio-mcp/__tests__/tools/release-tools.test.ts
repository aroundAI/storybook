import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryCache } from '@kit/cache';
import type { StorageAdapter } from '@kit/storage';

import { McpToolError } from '../../src/errors';
import type { McpPrincipal } from '../../src/principal';
import type { McpToolDefinition } from '../../src/registry';
import { buildMcpServer } from '../../src/server/build-server';
import { createEpisodeThumbnailTools } from '../../src/server/tools/author/episode-thumbnail';
import {
  discardHeldShortsTool,
  getChannelCadenceTool,
  getPublishCalendarTool,
  replanScheduleTool,
  requeueHeldShortsTool,
  reschedulePublishTool,
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
  previewBreakingRelease: vi.fn(),
  scheduleBreakingRelease: vi.fn(),
  readChannelCadences: vi.fn(),
  saveCadenceAndReplan: vi.fn(),
  reschedulePublishes: vi.fn(),
  replanSchedule: vi.fn(),
  requeueHeldShorts: vi.fn(),
  discardHeldShorts: vi.fn(),
  saveEpisodeThumbnail: vi.fn(),
}));

vi.mock('@kit/publishing/server/schedule-release', () => ({
  previewCadenceRelease: service.previewCadenceRelease,
  scheduleCadenceRelease: service.scheduleCadenceRelease,
  previewBreakingRelease: service.previewBreakingRelease,
  scheduleBreakingRelease: service.scheduleBreakingRelease,
  readChannelCadences: service.readChannelCadences,
  requeueHeldShorts: service.requeueHeldShorts,
  discardHeldShorts: service.discardHeldShorts,
}));

// FILM-2213: saving the cadence re-plans; moving a post in place
vi.mock('@kit/publishing/server/reschedule', () => ({
  saveCadenceAndReplan: service.saveCadenceAndReplan,
  reschedulePublishes: service.reschedulePublishes,
  replanSchedule: service.replanSchedule,
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
const HELD_ID = '00000000-0000-4000-8000-0000000000a1';
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
      channels: [],
      shortsQueue: [
        {
          connectionId: YT,
          name: 'Story YT',
          platform: 'youtube',
          queued: 24,
          lastShortAt: '2026-10-30T05:30:00.000Z',
          longVideosEndAt: '2026-10-21T14:30:00.000Z',
          daysAhead: 8.6,
          runsAhead: true,
        },
      ],
    },
  });
  service.scheduleCadenceRelease.mockResolvedValue({
    ok: true,
    data: { scheduled: [], shortsQueue: [] },
  });
});

const MOVE = {
  publishId: 'old-short',
  connectionId: YT,
  name: 'Story YT',
  platform: 'youtube',
  title: 'Ep 3 short 2',
  from: '2026-10-18T05:30:00.000Z',
  to: '2026-10-19T11:30:00.000Z',
};

describe('schedule_release with breaking (FILM-2210)', () => {
  beforeEach(() => {
    service.previewBreakingRelease.mockResolvedValue({
      ok: true,
      data: {
        placed: [
          {
            key: 'target-1',
            connectionId: YT,
            contentType: 'short',
            scheduledAt: '2026-10-18T08:30:00.000Z',
            extra: true,
          },
        ],
        moves: [MOVE],
        shortsQueue: [],
        quota: [{ day: '2026-10-18', uploads: 8 }],
      },
    });
    service.scheduleBreakingRelease.mockResolvedValue({
      ok: true,
      data: {
        scheduled: [],
        moves: [MOVE],
        shortsQueue: [],
        quota: [],
      },
    });
  });

  const BREAKING = {
    ...RELEASE,
    breaking: { boost: { extraPerDay: 3, days: 2 } },
  };

  it('previews through the breaking planner, writes nothing, and lists what moves and the quota warning', async () => {
    const fake = client();
    const result = await run(scheduleReleaseTool, BREAKING, fake);

    expect(service.previewBreakingRelease).toHaveBeenCalledTimes(1);
    expect(service.scheduleBreakingRelease).not.toHaveBeenCalled();
    expect(service.previewCadenceRelease).not.toHaveBeenCalled();
    expect(service.scheduleCadenceRelease).not.toHaveBeenCalled();
    expect(fake.calls.filter((c) => c.op !== 'select')).toEqual([]);

    const [, release] = service.previewBreakingRelease.mock.calls[0]!;
    expect(release.breaking).toEqual({ boost: { extraPerDay: 3, days: 2 } });
    expect(result.structuredContent).toMatchObject({
      preview: true,
      breaking: true,
      moves: [MOVE],
      quota: [{ day: '2026-10-18', uploads: 8 }],
    });
    expect(result.text).toContain(
      'Ep 3 short 2 on Story YT: 2026-10-18T05:30:00.000Z → 2026-10-19T11:30:00.000Z',
    );
    expect(result.text).toContain('(extra time)');
    expect(result.text).toContain('passed on 2026-10-18 (8)');
  });

  it('schedules as the person and says what moved', async () => {
    const result = await run(
      scheduleReleaseTool,
      { ...BREAKING, preview: false },
      client(),
    );

    expect(service.previewBreakingRelease).not.toHaveBeenCalled();
    expect(service.scheduleCadenceRelease).not.toHaveBeenCalled();
    const [, userId, release] = service.scheduleBreakingRelease.mock.calls[0]!;
    expect(userId).toBe('11111111-1111-4111-8111-111111111111');
    expect(release).toMatchObject({
      episodeId: EPISODE,
      breaking: { boost: { extraPerDay: 3, days: 2 } },
    });
    expect(result.structuredContent).toMatchObject({
      preview: false,
      breaking: true,
      moves: [MOVE],
    });
    expect(result.text).toContain('Moved back (1)');
  });

  it('is refused on a connection without studio:publish, and nothing is planned', async () => {
    const principal = {
      userId: 'u1',
      accountId: 'a1',
      connectionId: 'c1',
      scopes: ['studio:read', 'studio:write'],
      clientName: 'laptop',
      supabase: client().client,
    } as unknown as McpPrincipal;
    const cache = new MemoryCache();
    const server = buildMcpServer(
      principal,
      [scheduleReleaseTool] as never,
      {
        cache,
        limits: { callsPerMinute: 120, writesPerMinute: 20 },
        recordToolCall: async () => undefined,
        logInternalError: vi.fn(),
      },
      'req-1',
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const mcp = new Client({ name: 'test', version: '0' });
    await mcp.connect(clientSide);

    const result = await mcp.callTool({
      name: 'schedule_release',
      arguments: { ...BREAKING, preview: false },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'FORBIDDEN',
      details: { required_scope: 'studio:publish' },
    });
    expect(service.previewBreakingRelease).not.toHaveBeenCalled();
    expect(service.scheduleBreakingRelease).not.toHaveBeenCalled();

    await mcp.close();
    await server.close();
    cache.destroy();
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
      shortsQueue: [expect.objectContaining({ queued: 24, runsAhead: true })],
    });
    expect(result.structuredContent).not.toHaveProperty('held');
  });

  it('says when a channel’s Shorts queue runs more than 7 days past its long videos', async () => {
    const result = await run(scheduleReleaseTool, RELEASE, client());

    expect(result.text).toContain(
      'Story YT (youtube): 24 queued, the last 2026-10-30T05:30:00.000Z, 8.6 days past the last long video — more than 7 days',
    );
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

const SAVED = {
  connectionId: YT,
  contentType: 'short',
  saved: true,
  replan: { dryRun: false, moves: [], notMoved: [] },
  replanRefusal: null,
};

const MOVED = {
  publishId: 'p-short-1',
  episodeId: EPISODE,
  episode: 'Ep 3 · Fallen Unicorns',
  platform: 'youtube',
  connectionId: YT,
  kind: 'short',
  title: 'Short 1',
  from: '2026-10-25T05:30:00.000Z',
  to: '2026-10-25T21:00:00.000Z',
};

describe('the channel cadence', () => {
  const CADENCE = {
    connectionId: YT,
    contentType: 'short',
    timezone: 'Asia/Kolkata',
    slotTimes: ['21:00', '11:00'],
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    minDaysBetween: 0,
    // The tool's input schema fills it in; the handler is called directly
    everyNDays: 1,
    startAfterHours: 2,
    jitterMinutes: 15,
    enabled: true,
  };

  it('sets a channel of the team through the dialog’s save', async () => {
    service.saveCadenceAndReplan.mockResolvedValue({
      ok: true,
      data: SAVED,
    });

    await run(setChannelCadenceTool, CADENCE, client());

    expect(service.saveCadenceAndReplan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ via: 'mcp' }),
      expect.objectContaining({ connectionId: YT, startAfterHours: 2 }),
      { dryRun: false },
    );
  });

  it('sets Shorts every N days, and refuses it for long videos', async () => {
    service.saveCadenceAndReplan.mockResolvedValue({
      ok: true,
      data: SAVED,
    });

    const set = await run(
      setChannelCadenceTool,
      { ...CADENCE, everyNDays: 2 },
      client(),
    );
    expect(set.text).toContain('every 2 days');
    expect(service.saveCadenceAndReplan).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ everyNDays: 2 }),
      { dryRun: false },
    );

    service.saveCadenceAndReplan.mockClear();
    const error = await rejection(
      run(
        setChannelCadenceTool,
        { ...CADENCE, contentType: 'full', everyNDays: 3 },
        client(),
      ),
    );
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toContain('days between them');
    expect(service.saveCadenceAndReplan).not.toHaveBeenCalled();
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
    expect(service.saveCadenceAndReplan).not.toHaveBeenCalled();
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
    expect(service.saveCadenceAndReplan).not.toHaveBeenCalled();
  });

  it('re-plans what is scheduled on the channel in the same call, and says what moved (FILM-2213)', async () => {
    service.saveCadenceAndReplan.mockResolvedValue({
      ok: true,
      data: {
        ...SAVED,
        replan: { dryRun: false, moves: [MOVED], notMoved: [] },
      },
    });

    const result = await run(setChannelCadenceTool, CADENCE, client());

    expect(result.text).toContain('1 scheduled post moved onto it');
    expect(result.text).toContain(`${MOVED.from} → ${MOVED.to}`);
    expect(result.structuredContent.replan).toEqual({
      dryRun: false,
      moves: [MOVED],
      notMoved: [],
    });
  });

  it('dryRun saves nothing and says what would move (FILM-2213)', async () => {
    service.saveCadenceAndReplan.mockResolvedValue({
      ok: true,
      data: {
        ...SAVED,
        saved: false,
        replan: { dryRun: true, moves: [MOVED], notMoved: [] },
      },
    });

    const result = await run(
      setChannelCadenceTool,
      { ...CADENCE, dryRun: true },
      client(),
    );

    expect(service.saveCadenceAndReplan).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.not.objectContaining({ dryRun: expect.anything() }),
      { dryRun: true },
    );
    expect(result.text).toContain('nothing saved');
    expect(result.text).toContain('1 scheduled post would move');
    expect(result.structuredContent.saved).toBe(false);
  });

  it('says the rules are saved when the re-plan fails, and why nothing moved (FILM-2213)', async () => {
    service.saveCadenceAndReplan.mockResolvedValue({
      ok: true,
      data: {
        ...SAVED,
        replan: null,
        replanRefusal: 'YouTube refused to move the video.',
      },
    });

    const result = await run(setChannelCadenceTool, CADENCE, client());

    expect(result.text).toContain("The channel's Shorts cadence is");
    expect(result.text).toContain(
      'The scheduled posts did not move: YouTube refused to move the video.',
    );
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

describe('reschedule_publish (FILM-2213)', () => {
  const PUBLISH_ID = '00000000-0000-4000-8000-0000000000b1';
  const AT = '2026-10-26T16:00:00-04:00';
  const ofTeam = (inTeam: boolean) =>
    client({
      publishes: () => ({
        data: inTeam ? { id: PUBLISH_ID, episode_id: EPISODE } : null,
      }),
    });

  it('moves the post through the service and returns its result as it is', async () => {
    const data = {
      dryRun: false,
      moves: [MOVED],
      cadenceRefusal: null,
      manualTime: true,
    };
    service.reschedulePublishes.mockResolvedValue({ ok: true, data });

    const result = await run(
      reschedulePublishTool,
      {
        publishId: PUBLISH_ID,
        scheduledAt: AT,
        ignoreCadence: true,
        note: 'testing 4 pm',
        preview: false,
      },
      ofTeam(true),
    );

    expect(service.reschedulePublishes).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ via: 'mcp', note: 'testing 4 pm' }),
      { publishId: PUBLISH_ID, scheduledAt: AT, ignoreCadence: true },
      { dryRun: false },
    );
    expect(result.structuredContent).toEqual({ preview: false, ...data });
    expect(result.text).toContain('manualTime');
  });

  it('moves an episode’s long video by its episode, previewed', async () => {
    service.reschedulePublishes.mockResolvedValue({
      ok: true,
      data: {
        dryRun: true,
        moves: [],
        cadenceRefusal: 'Story YT has a long video on 2026-10-25.',
        manualTime: false,
      },
    });

    const result = await run(
      reschedulePublishTool,
      {
        episodeId: EPISODE,
        contentType: 'full',
        scheduledAt: AT,
        preview: true,
      },
      client(),
    );

    expect(service.reschedulePublishes).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { episodeId: EPISODE, contentType: 'full', scheduledAt: AT },
      { dryRun: true },
    );
    expect(result.text).toContain('The posting rules refuse this time');
  });

  it('refuses another team’s post before the service is asked', async () => {
    const error = await rejection(
      run(
        reschedulePublishTool,
        { publishId: PUBLISH_ID, scheduledAt: AT, preview: false },
        ofTeam(false),
      ),
    );

    expect(error.code).toBe('NOT_FOUND');
    expect(service.reschedulePublishes).not.toHaveBeenCalled();
  });

  it('says the service’s refusal in its words', async () => {
    service.reschedulePublishes.mockResolvedValue({
      ok: false,
      refusal: 'It has already gone out, so its time cannot change.',
    });

    const error = await rejection(
      run(
        reschedulePublishTool,
        { publishId: PUBLISH_ID, scheduledAt: AT, preview: false },
        ofTeam(true),
      ),
    );

    expect(error.message).toContain('already gone out');
  });

  it('wants a post or an episode, not both', async () => {
    const error = await rejection(
      run(
        reschedulePublishTool,
        {
          publishId: PUBLISH_ID,
          episodeId: EPISODE,
          contentType: 'full',
          scheduledAt: AT,
          preview: false,
        },
        ofTeam(true),
      ),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(service.reschedulePublishes).not.toHaveBeenCalled();
  });
});

describe('replan_schedule (FILM-2213)', () => {
  it('previews by default and returns the moves as the service gives them', async () => {
    const data = {
      dryRun: true,
      moves: [MOVED],
      notMoved: [{ publishId: 'p-x', reason: 'No free slot.' }],
    };
    service.replanSchedule.mockResolvedValue({ ok: true, data });

    const result = await run(
      replanScheduleTool,
      { projectId: PROJECT, dryRun: true },
      client(),
    );

    expect(service.replanSchedule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ via: 'mcp' }),
      { projectId: PROJECT, dryRun: true },
    );
    expect(result.structuredContent).toEqual({ projectId: PROJECT, ...data });
    expect(result.text).toContain('1 post would move');
    expect(result.text).toContain('Not moved');
  });

  it('refuses another team’s project', async () => {
    const error = await rejection(
      run(
        replanScheduleTool,
        { projectId: PROJECT, dryRun: false },
        createFakeClient({ projects: () => ({ data: null }) }),
      ),
    );

    expect(error.code).toBe('NOT_FOUND');
    expect(service.replanSchedule).not.toHaveBeenCalled();
  });
});

describe('held Shorts', () => {
  const heldOf = (episodeInTeam: boolean) =>
    client({
      episodeInTeam,
      publishes: () => ({ data: [{ id: HELD_ID, episode_id: EPISODE }] }),
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
            publishIds: [HELD_ID],
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
      publishes: (call) => {
        if (!call.filters.some((f) => f.method === 'or')) return { data: [] };
        // PostgREST's max_rows: an unpaged read is cut at 1000, silently
        const paged = call.filters.some((f) => f.method === 'range');
        return { data: paged ? rows : rows.slice(0, 1000) };
      },
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

  it('marks a breaking post and names its episode’s slug (FILM-2211)', async () => {
    const breaking = row(1, {
      release_priority: 'breaking',
      episodes: {
        title: 'Fallen Unicorns',
        number: 2,
        slug: 'fallen-unicorns',
      },
    });
    const queued = row(2, { release_priority: 'normal' });
    const fake = client({
      publishes: (call) =>
        call.filters.some((f) => f.method === 'or')
          ? { data: [breaking, queued] }
          : { data: [] },
    });

    const result = await run(getPublishCalendarTool, RANGE, fake);

    expect(result.structuredContent.posts).toEqual([
      expect.objectContaining({
        breaking: true,
        episodeSlug: 'fallen-unicorns',
      }),
      expect.objectContaining({ breaking: false }),
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
          key.includes('missing') ? null : { bytes: 1234 },
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
    expect(error.message).toContain('key must be');
    expect(service.saveEpisodeThumbnail).not.toHaveBeenCalled();
  });

  it('refuses a key nothing was uploaded to', async () => {
    const error = await rejection(
      run(
        finalize,
        {
          episodeId: EPISODE,
          language: 'en',
          key: `episodes/${EPISODE}/thumbnails/en-missing.png`,
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
