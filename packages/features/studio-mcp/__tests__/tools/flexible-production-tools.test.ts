import { describe, expect, it, vi } from 'vitest';

import type { StorageAdapter } from '@kit/storage';

import { McpToolError } from '../../src/errors';
import type { McpToolDefinition } from '../../src/registry';
import {
  createEpisodeVideoTools,
  linkPublishedVideoTool,
  setStageSkippedTool,
} from '../../src/server/tools/author/episode-production';
import { createEpisodeTool } from '../../src/server/tools/author/episodes';
import {
  createSeasonTool,
  deleteSeasonTool,
  reorderSeasonsTool,
} from '../../src/server/tools/author/seasons';
import { refuseMissingInputs } from '../../src/server/tools/generation/stage-inputs';
import {
  type RecordedCall,
  createFakeClient,
  fakeContext,
} from '../helpers/fake-supabase';

/**
 * FILM-2204: the seasons, skipped stages and finished-video tools, against a
 * recording client. The SQL behind reorder_seasons and soft_delete_season is
 * pinned by flexible-production.test.sql; here, what each tool sends and how
 * it answers.
 */
// The KB-123 own-upload check recognises an episode's upload by the public
// URL the storage provider gives it
vi.stubEnv('STORAGE_PROVIDER', 'r2');
vi.stubEnv(
  'R2_PUBLIC_URL',
  'https://pub-0123456789abcdef0123456789abcdef.r2.dev',
);

// FILM-2206: the follow-up snapshot reads performance through the
// FILM-1912 reader; here ClickHouse is off
vi.mock('@kit/content-analytics/server/performance-reader', () => ({
  createPerformanceReader: () => ({
    videos: async () => ({
      status: 'unmeasured',
      reason: 'ClickHouse is off.',
    }),
  }),
}));

const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const SEASON = '55555555-5555-4555-8555-555555555555';
const EPISODE = '66666666-6666-4666-8666-666666666666';

const project = { id: PROJECT, account_id: ACCOUNT };
const seasonRow = {
  id: SEASON,
  project_id: PROJECT,
  number: 3,
  name: 'Origins',
  description: null,
  direction_notes: null,
  cover_url: null,
  version: 1,
  created_at: '2026-10-09T00:00:00Z',
  updated_at: '2026-10-09T00:00:00Z',
  deleted_at: null,
};

async function rejection(promise: Promise<unknown>): Promise<McpToolError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof McpToolError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

const call = (
  tool: { handler: (input: never, context: never) => Promise<unknown> },
  client: ReturnType<typeof createFakeClient>['client'],
  input: Record<string, unknown>,
) => tool.handler(input as never, fakeContext(client) as never);

describe('season tools', () => {
  it('create_season numbers after the highest live season', async () => {
    const fake = createFakeClient({
      projects: project,
      seasons: (c: RecordedCall) =>
        c.op === 'insert'
          ? { data: { ...seasonRow, ...(c.payload as object) } }
          : { data: [{ number: 2 }] },
    });

    const result = (await call(createSeasonTool, fake.client, {
      projectId: PROJECT,
      name: 'Origins',
    })) as { structuredContent: { season: { number: number } } };

    const insert = fake.calls.find((c) => c.op === 'insert');
    expect(insert?.payload).toMatchObject({
      project_id: PROJECT,
      number: 3,
      name: 'Origins',
    });
    expect(result.structuredContent.season.number).toBe(3);
  });

  it('delete_season moves the episodes and says how many', async () => {
    const fake = createFakeClient({
      seasons: { id: SEASON, project_id: PROJECT, version: 2 },
      'rpc:soft_delete_season': 2,
    });

    const result = (await call(deleteSeasonTool, fake.client, {
      seasonId: SEASON,
      version: 2,
    })) as { structuredContent: { episodesMoved: number } };

    expect(result.structuredContent.episodesMoved).toBe(2);
    expect(fake.calls.find((c) => c.op === 'rpc')?.payload).toEqual({
      p_season_id: SEASON,
      p_version: 2,
    });
  });

  it.each([
    ['42501', 'FORBIDDEN'],
    ['40001', 'TARGET_CHANGED'],
    ['P0002', 'NOT_FOUND'],
  ])('delete_season answers %s as %s', async (sqlstate, code) => {
    const fake = createFakeClient({
      seasons: { id: SEASON, project_id: PROJECT, version: 2 },
      'rpc:soft_delete_season': () => ({
        error: { code: sqlstate, message: 'x' },
      }),
    });

    const error = await rejection(
      call(deleteSeasonTool, fake.client, { seasonId: SEASON, version: 2 }),
    );

    expect(error.code).toBe(code);
  });

  it('reorder_seasons refuses a partial list field by field', async () => {
    const fake = createFakeClient({
      projects: project,
      'rpc:reorder_seasons': () => ({
        error: { code: '22023', message: 'x' },
      }),
    });

    const error = await rejection(
      call(reorderSeasonsTool, fake.client, {
        projectId: PROJECT,
        seasonIds: [SEASON],
      }),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details?.errors).toEqual([
      expect.objectContaining({ path: ['seasonIds'] }),
    ]);
  });
});

describe('set_stage_skipped', () => {
  it('keeps the skipped stages in workspace order', async () => {
    const fake = createFakeClient({
      episodes: (c: RecordedCall) =>
        c.op === 'update'
          ? { data: { id: EPISODE, ...(c.payload as object), version: 5 } }
          : {
              data: {
                id: EPISODE,
                skipped_stages: ['shots'],
                version: 4,
                project: { id: PROJECT, account_id: ACCOUNT },
              },
            },
    });

    const result = (await call(setStageSkippedTool, fake.client, {
      episodeId: EPISODE,
      version: 4,
      stage: 'story',
      skipped: true,
    })) as { structuredContent: { skippedStages: string[] } };

    expect(result.structuredContent.skippedStages).toEqual(['story', 'shots']);
  });
});

describe('episode video tools', () => {
  const episodeAnswer = (c: RecordedCall) =>
    c.op === 'update'
      ? { data: [{ id: EPISODE }] }
      : {
          data: {
            id: EPISODE,
            project_id: PROJECT,
            status: 'draft',
            final_video_url: null,
            localized_videos: null,
            shorts_groups: null,
            project: { id: PROJECT, account_id: ACCOUNT },
          },
        };

  function storage(stat: { bytes: number } | null) {
    const signed: string[] = [];
    const adapter = {
      getSignedUploadUrl: async (_bucket: string, key: string) => {
        signed.push(key);
        return {
          uploadUrl: `https://r2/${key}?sig`,
          headers: {},
          expiresIn: 3600,
        };
      },
      stat: async () => stat,
      getPublicUrl: (_bucket: string, key: string) =>
        `https://pub-0123456789abcdef0123456789abcdef.r2.dev/project-assets/${key}`,
    } as unknown as StorageAdapter;

    return { adapter, signed };
  }

  const tools = (adapter: StorageAdapter) => {
    const [request, finalize] = createEpisodeVideoTools({
      storage: () => adapter,
      now: () => 1700000000000,
    }) as [McpToolDefinition, McpToolDefinition];

    return { request, finalize };
  };

  it('request_episode_video_upload signs the publish screen’s own path, after the project write check', async () => {
    const fake = createFakeClient({
      episodes: episodeAnswer,
      'rpc:can_write_project_storage': true,
    });
    const store = storage(null);

    const result = (await tools(store.adapter).request.handler(
      {
        episodeId: EPISODE,
        language: 'en',
        contentType: 'video/mp4',
        bytes: 1024,
      } as never,
      fakeContext(fake.client) as never,
    )) as { structuredContent: { key: string } };

    expect(result.structuredContent.key).toBe(
      `episodes/${EPISODE}/videos/en-1700000000000.mp4`,
    );
    expect(store.signed).toEqual([result.structuredContent.key]);
    expect(fake.tables()).toContain('rpc:can_write_project_storage');
  });

  it('request_episode_video_upload refuses a caller who cannot write the project', async () => {
    const fake = createFakeClient({
      episodes: episodeAnswer,
      'rpc:can_write_project_storage': false,
    });

    const error = await rejection(
      tools(storage(null).adapter).request.handler(
        {
          episodeId: EPISODE,
          language: 'en',
          contentType: 'video/mp4',
          bytes: 1024,
        } as never,
        fakeContext(fake.client) as never,
      ),
    );

    expect(error.code).toBe('FORBIDDEN');
  });

  it("finalize_episode_video refuses a key outside the episode's own videos", async () => {
    const fake = createFakeClient({ episodes: episodeAnswer });

    const error = await rejection(
      tools(storage({ bytes: 9 }).adapter).finalize.handler(
        {
          episodeId: EPISODE,
          language: 'en',
          key: `episodes/77777777-7777-4777-8777-777777777777/videos/en-1.mp4`,
        } as never,
        fakeContext(fake.client) as never,
      ),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(fake.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('finalize_episode_video refuses when nothing was uploaded', async () => {
    const fake = createFakeClient({ episodes: episodeAnswer });

    const error = await rejection(
      tools(storage(null).adapter).finalize.handler(
        {
          episodeId: EPISODE,
          language: 'en',
          key: `episodes/${EPISODE}/videos/en-1700000000000.mp4`,
        } as never,
        fakeContext(fake.client) as never,
      ),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(fake.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('finalize_episode_video makes it the language’s video and the episode ready', async () => {
    const fake = createFakeClient({ episodes: episodeAnswer });
    const key = `episodes/${EPISODE}/videos/en-1700000000000.mp4`;

    const result = (await tools(
      storage({ bytes: 2048 }).adapter,
    ).finalize.handler(
      { episodeId: EPISODE, language: 'en', key } as never,
      fakeContext(fake.client) as never,
    )) as { structuredContent: { status: string; videoUrl: string } };

    expect(result.structuredContent.status).toBe('ready');
    expect(fake.calls.find((c) => c.op === 'update')?.payload).toEqual({
      localized_videos: { en: result.structuredContent.videoUrl },
      status: 'ready',
    });
  });
});

describe('link_published_video', () => {
  it('refuses a video already linked to another episode, writing nothing', async () => {
    const fake = createFakeClient({
      episodes: {
        id: EPISODE,
        project: { id: PROJECT, account_id: ACCOUNT },
      },
      publishes: (c: RecordedCall) =>
        c.op === 'select' ? { data: [{ id: 'elsewhere' }] } : { data: null },
    });

    const error = await rejection(
      call(linkPublishedVideoTool, fake.client, {
        episodeId: EPISODE,
        platform: 'youtube',
        platformUrl: 'https://www.youtube.com/watch?v=abc123DEF45',
      }),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toMatch(/already linked to another episode/);
    expect(fake.calls.some((c) => c.op === 'insert' || c.op === 'update')).toBe(
      false,
    );
  });
});

describe('MISSING_INPUTS (start_generation)', () => {
  const client = (episode: Record<string, unknown>) =>
    createFakeClient({
      episodes: {
        status: 'draft',
        story_data: null,
        screenplay_data: null,
        shot_list: null,
        final_video_url: null,
        skipped_stages: [],
        ...episode,
      },
      shots: () => ({ data: [], count: 0 }),
      audio_cues: () => ({ data: [], count: 0 }),
    }).client;

  it('refuses a screenplay run with no story, naming it', async () => {
    const error = await rejection(
      refuseMissingInputs(client({}), 'screenplay', EPISODE),
    );

    expect(error.code).toBe('MISSING_INPUTS');
    expect(error.details).toEqual({ stage: 'screenplay', missing: ['story'] });
  });

  it('lets a shots run start from a screenplay with no story (an imported script)', async () => {
    await expect(
      refuseMissingInputs(
        client({ screenplay_data: { scenes: [] }, skipped_stages: ['story'] }),
        'shots',
        EPISODE,
      ),
    ).resolves.toBeUndefined();
  });

  it('never checks a stage that reads nothing earlier', async () => {
    await expect(
      refuseMissingInputs(client({}), 'story', EPISODE),
    ).resolves.toBeUndefined();
  });
});

describe('create_episode startFrom (FILM-2205)', () => {
  it('records how the episode starts and skips the stages that start passes', async () => {
    const fake = createFakeClient({
      projects: project,
      episodes: (c: RecordedCall) =>
        c.op === 'insert'
          ? {
              data: {
                id: EPISODE,
                project_id: PROJECT,
                season_id: null,
                number: 1,
                slug: 'e',
                title: 'Cut',
                description: null,
                status: 'draft',
                version: 1,
                metadata: {},
                target_duration_seconds: null,
                created_at: '2026-10-09T00:00:00Z',
                updated_at: '2026-10-09T00:00:00Z',
                ...(c.payload as object),
              },
            }
          : { data: [] },
    });

    await call(createEpisodeTool, fake.client, {
      projectId: PROJECT,
      title: 'Cut',
      startFrom: 'video',
    });

    expect(fake.calls.find((c) => c.op === 'insert')?.payload).toMatchObject({
      entry_mode: 'video',
      skipped_stages: ['ideation', 'story', 'screenplay', 'shots', 'audio'],
    });
  });
});

describe('create_episode followUpOf (FILM-2206)', () => {
  const SOURCE = '77777777-7777-4777-8777-777777777777';

  function client(source: Record<string, unknown> | null) {
    return createFakeClient({
      projects: project,
      shots: [],
      episodes: (c: RecordedCall) =>
        c.op === 'insert'
          ? {
              data: {
                id: EPISODE,
                project_id: PROJECT,
                season_id: null,
                number: 2,
                slug: 'e',
                title: 'Next',
                description: null,
                status: 'draft',
                version: 1,
                metadata: {},
                target_duration_seconds: null,
                created_at: '2026-10-09T00:00:00Z',
                updated_at: '2026-10-09T00:00:00Z',
                ...(c.payload as object),
              },
            }
          : c.filters.some(
                (f) =>
                  f.method === 'eq' &&
                  f.args[0] === 'id' &&
                  f.args[1] === SOURCE,
              )
            ? { data: source ? [source] : [] }
            : { data: [] },
    });
  }

  it('freezes the source episode into metadata.follow_up', async () => {
    const fake = client({
      id: SOURCE,
      number: 1,
      title: 'The Gate',
      duration_seconds: null,
      story_data: { viralStructure: { openingHook: 'A door opens.' } },
      screenplay_data: null,
    });

    await call(createEpisodeTool, fake.client, {
      projectId: PROJECT,
      title: 'Next',
      followUpOf: SOURCE,
    });

    const read = fake.calls.find(
      (c) => c.table === 'episodes' && c.op === 'select',
    );
    expect(read?.filters).toContainEqual({
      method: 'eq',
      args: ['project_id', PROJECT],
    });
    expect(fake.calls.find((c) => c.op === 'insert')?.payload).toMatchObject({
      metadata: {
        follow_up: {
          episode_id: SOURCE,
          snapshot: {
            title: 'The Gate',
            traits: { hook: 'A door opens.' },
            performance: {
              status: 'unmeasured',
              reason: 'ClickHouse is off.',
            },
          },
        },
      },
    });
  });

  it('refuses an episode it cannot see in the project, and creates nothing', async () => {
    const fake = client(null);

    const error = await rejection(
      call(createEpisodeTool, fake.client, {
        projectId: PROJECT,
        title: 'Next',
        followUpOf: SOURCE,
      }),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toContain('live episode of this project');
    expect(fake.calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('refuses a follow-up that does not start from an idea', async () => {
    const fake = client(null);

    const error = await rejection(
      call(createEpisodeTool, fake.client, {
        projectId: PROJECT,
        title: 'Next',
        startFrom: 'script',
        followUpOf: SOURCE,
      }),
    );

    expect(error.message).toContain('starts from an idea');
    expect(fake.calls.some((c) => c.op === 'insert')).toBe(false);
  });
});
