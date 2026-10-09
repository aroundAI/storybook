import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { McpToolError } from '../../src/errors';
import {
  PAGE_LIMIT_MAX,
  decodeCursor,
  encodeCursor,
} from '../../src/server/tools/pagination';
import { readTools } from '../../src/server/tools/read';
import {
  getEpisodeTool,
  listEpisodesTool,
} from '../../src/server/tools/read/episodes';
import {
  getProjectTool,
  listProjectsTool,
} from '../../src/server/tools/read/projects';
import { getScreenplayTool } from '../../src/server/tools/read/stage-content';
import { deriveStages } from '../../src/server/tools/read/stage-status';
import { createFakeClient, fakeContext } from '../helpers/fake-supabase';

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EPISODE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

const PAGED_TOOLS = [
  'list_projects',
  'list_episodes',
  'get_screenplay',
  'get_shots',
  'get_dialogue',
  'list_assets',
];

describe('read tool registration', () => {
  it('registers the eight read tools, all studio:read and read-only', () => {
    expect(readTools.map((tool) => tool.name).sort()).toEqual(
      [
        'get_dialogue',
        'get_episode',
        'get_project',
        'get_screenplay',
        'get_shots',
        'list_assets',
        'list_episodes',
        'list_projects',
      ].sort(),
    );

    for (const tool of readTools) {
      expect(tool.scope).toBe('studio:read');
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
      expect(tool.annotations.idempotentHint).toBe(true);
    }
  });

  it('every paged tool takes cursor and limit (max 50) and says so in its description', () => {
    for (const tool of readTools.filter((t) => PAGED_TOOLS.includes(t.name))) {
      expect(Object.keys(tool.inputSchema)).toContain('cursor');
      expect(Object.keys(tool.inputSchema)).toContain('limit');
      expect(tool.description).toMatch(/cursor/);
      expect(tool.description).toMatch(/limit/);
      expect(tool.description).toMatch(/50/);

      const schema = z.object(tool.inputSchema);
      const base =
        tool.name.startsWith('list_') && tool.name !== 'list_episodes'
          ? tool.name === 'list_assets'
            ? { projectId: PROJECT_ID }
            : {}
          : tool.name === 'list_episodes'
            ? { projectId: PROJECT_ID }
            : { episodeId: EPISODE_ID };

      expect(schema.safeParse({ ...base, limit: 51 }).success).toBe(false);
      expect(schema.safeParse({ ...base, limit: 0 }).success).toBe(false);
      expect(schema.safeParse({ ...base, limit: PAGE_LIMIT_MAX }).success).toBe(
        true,
      );
    }

    const sceneTools = readTools.filter((t) =>
      ['get_screenplay', 'get_shots', 'get_dialogue'].includes(t.name),
    );
    for (const tool of sceneTools) {
      expect(tool.description).toMatch(/scene/i);
    }
  });
});

describe('cursors', () => {
  it('round-trip and reject garbage as VALIDATION_FAILED', () => {
    const cursor = encodeCursor({ after: 7 });
    expect(decodeCursor(cursor, z.object({ after: z.number() }))).toEqual({
      after: 7,
    });

    expect(() =>
      decodeCursor('not-a-cursor', z.object({ after: z.number() })),
    ).toThrowError(McpToolError);

    try {
      decodeCursor('not-a-cursor', z.object({ after: z.number() }));
    } catch (error) {
      expect((error as McpToolError).code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('list_projects', () => {
  it('asks for the connection team only and pages the result', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${i}`,
      account_id: ACCOUNT_ID,
      name: `P${i}`,
      slug: `p${i}`,
      description: null,
      status: 'active',
      metadata: {},
      created_at: `2026-10-0${i + 1}T00:00:00Z`,
      updated_at: `2026-10-0${i + 1}T00:00:00Z`,
      user_role: 'owner',
    }));

    const fake = createFakeClient({ 'rpc:get_account_projects': rows });
    const context = fakeContext(fake.client);

    const page1 = await listProjectsTool.handler(
      { limit: 2, cursor: undefined, status: undefined },
      context,
    );

    const rpc = fake.calls.find((call) => call.op === 'rpc');
    expect(rpc?.payload).toEqual({ target_account_id: ACCOUNT_ID });

    const projects1 = page1.structuredContent.projects as Array<{ id: string }>;
    expect(projects1).toHaveLength(2);
    expect(page1.structuredContent.nextCursor).toBeTypeOf('string');

    const page2 = await listProjectsTool.handler(
      {
        limit: 2,
        cursor: page1.structuredContent.nextCursor as string,
        status: undefined,
      },
      context,
    );
    const projects2 = page2.structuredContent.projects as Array<{ id: string }>;
    expect(projects2).toHaveLength(1);
    expect(page2.structuredContent.nextCursor).toBeNull();
    expect(new Set([...projects1, ...projects2].map((p) => p.id)).size).toBe(3);
  });
});

describe('get_project', () => {
  it('returns NOT_FOUND when RLS or the team filter leaves no row', async () => {
    const fake = createFakeClient({ projects: [] });

    await expect(
      getProjectTool.handler(
        { projectId: PROJECT_ID },
        fakeContext(fake.client),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const select = fake.calls.find((call) => call.table === 'projects');
    expect(
      select?.filters.some(
        (filter) =>
          filter.method === 'eq' &&
          filter.args[0] === 'account_id' &&
          filter.args[1] === ACCOUNT_ID,
      ),
    ).toBe(true);
  });
});

describe('list_episodes and get_episode', () => {
  it('exclude soft-deleted episodes explicitly, as the web pages do', async () => {
    const fake = createFakeClient({
      projects: [{ id: PROJECT_ID, account_id: ACCOUNT_ID }],
      episodes: [],
    });

    await listEpisodesTool.handler(
      {
        projectId: PROJECT_ID,
        limit: 10,
        cursor: undefined,
        status: undefined,
        seasonId: undefined,
      },
      fakeContext(fake.client),
    );

    const listSelect = fake.calls.find((call) => call.table === 'episodes');
    expect(
      listSelect?.filters.some(
        (filter) =>
          filter.method === 'is' &&
          filter.args[0] === 'deleted_at' &&
          filter.args[1] === null,
      ),
    ).toBe(true);

    await expect(
      getEpisodeTool.handler(
        { episodeId: EPISODE_ID },
        fakeContext(fake.client),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const getSelect = fake.calls.filter((call) => call.table === 'episodes')[1];
    expect(
      getSelect?.filters.some(
        (filter) =>
          filter.method === 'is' &&
          filter.args[0] === 'deleted_at' &&
          filter.args[1] === null,
      ),
    ).toBe(true);
  });

  it('get_episode reports stages, counts and the per-stage origin from episodes.generation_origin', async () => {
    const episode = {
      id: EPISODE_ID,
      project_id: PROJECT_ID,
      season_id: null,
      number: 2,
      slug: 'ep-2',
      title: 'Two',
      description: 'desc',
      status: 'story',
      version: 4,
      metadata: { content_style: 'balanced', target_duration: 300 },
      target_duration_seconds: 300,
      duration_seconds: null,
      thumbnail_url: null,
      final_video_url: null,
      story_data: { logline: 'A tale', fullStory: 'Once...' },
      screenplay_data: {
        scenes: [
          { number: 1, heading: 'INT. HALL', dialogue: [{}, {}] },
          { number: 2, heading: 'EXT. PIER', dialogue: [{}] },
        ],
        metadata: { totalScenes: 2, estimatedDuration: 120 },
      },
      shot_list: null,
      generation_origin: {
        story: { kind: 'external', clientName: 'Claude', runId: 'r1' },
      },
      deleted_at: null,
      created_at: '2026-10-03T00:00:00Z',
      updated_at: '2026-10-03T00:00:00Z',
      project: { account_id: ACCOUNT_ID, name: 'P', slug: 'p' },
    };

    const fake = createFakeClient({
      episodes: [episode],
      shots: () => ({ data: [], count: 5 }),
      dialogue_lines: () => ({ data: [], count: 3 }),
      audio_cues: () => ({ data: [], count: 0 }),
      assets: () => ({ data: [], count: 2 }),
    });

    const result = await getEpisodeTool.handler(
      { episodeId: EPISODE_ID },
      fakeContext(fake.client),
    );

    const content = result.structuredContent as {
      episode: { id: string; status: string };
      counts: Record<string, number>;
      stages: Array<{ key: string; state: string; origin: unknown }>;
      screenplaySummary: { scenes: number; headings: string[] } | null;
      origin: { perStage: Record<string, unknown> };
    };

    expect(content.episode.id).toBe(EPISODE_ID);
    expect(content.episode.status).toBe('story');
    expect(content.counts).toEqual({
      scenes: 2,
      shots: 5,
      dialogueLines: 3,
      assets: 2,
    });
    expect(content.screenplaySummary).toMatchObject({
      scenes: 2,
      headings: ['INT. HALL', 'EXT. PIER'],
    });
    expect(content.stages.map((s) => s.key)).toEqual([
      'ideation',
      'story',
      'screenplay',
      'shots',
      'audio',
      'publish',
    ]);
    expect(content.stages.find((s) => s.key === 'story')?.state).toBe('done');
    expect(content.stages.find((s) => s.key === 'shots')?.state).toBe('done');
    expect(content.stages.find((s) => s.key === 'audio')?.state).toBe(
      'available',
    );
    expect(content.stages.find((s) => s.key === 'story')?.origin).toEqual({
      kind: 'external',
      clientName: 'Claude',
      runId: 'r1',
    });
    expect(
      content.stages
        .filter((s) => s.key !== 'story')
        .every((s) => s.origin === null),
    ).toBe(true);
    expect(content.origin.perStage).toEqual(episode.generation_origin);
    expect(result.text).toMatch(/Two/);
  });
});

describe('deriveStages', () => {
  it('follows the workspace tabs: a stage unlocks when the one before has data', () => {
    const stages = deriveStages({
      status: 'draft',
      storyData: null,
      screenplayData: null,
      shotList: null,
      finalVideoUrl: null,
      shotCount: 0,
      dialogueLineCount: 0,
      audioCueCount: 0,
      origin: null,
    });

    expect(stages.map((s) => [s.key, s.state])).toEqual([
      ['ideation', 'available'],
      ['story', 'available'],
      ['screenplay', 'locked'],
      ['shots', 'locked'],
      ['audio', 'locked'],
      ['publish', 'locked'],
    ]);
  });

  it('reads per-stage origin from episodes.generation_origin when present', () => {
    const stages = deriveStages({
      status: 'storyboard',
      storyData: { logline: 'x' },
      screenplayData: { scenes: [] },
      shotList: null,
      finalVideoUrl: null,
      shotCount: 3,
      dialogueLineCount: 0,
      audioCueCount: 1,
      origin: {
        story: { kind: 'external', client_name: 'Claude' },
        screenplay_refinement: { kind: 'server', model: 'gemini' },
        audio_cues: { kind: 'server' },
      },
    });

    expect(stages.find((s) => s.key === 'story')?.origin).toEqual({
      kind: 'external',
      client_name: 'Claude',
    });
    expect(stages.find((s) => s.key === 'screenplay')?.origin).toEqual({
      kind: 'server',
      model: 'gemini',
    });
    expect(stages.find((s) => s.key === 'audio')?.origin).toEqual({
      kind: 'server',
    });
    expect(stages.find((s) => s.key === 'shots')?.origin).toBeNull();
    expect(stages.find((s) => s.key === 'audio')?.state).toBe('done');
  });
});

describe('deriveStages over the shared stage state (FILM-2201)', () => {
  // The rule as get_episode applied it before FILM-2201, for every stage but
  // publish: a stage is done with its output, available when the one before
  // has output, locked otherwise.
  function before(input: {
    story: boolean;
    screenplay: boolean;
    shots: boolean;
    audio: boolean;
  }) {
    return {
      ideation: 'available',
      story: input.story ? 'done' : 'available',
      screenplay: input.screenplay
        ? 'done'
        : input.story
          ? 'available'
          : 'locked',
      shots: input.shots ? 'done' : input.screenplay ? 'available' : 'locked',
      audio: input.audio ? 'done' : input.shots ? 'available' : 'locked',
    };
  }

  const combos = Array.from({ length: 16 }, (_, bits) => ({
    story: Boolean(bits & 1),
    screenplay: Boolean(bits & 2),
    shots: Boolean(bits & 4),
    audio: Boolean(bits & 8),
  }));

  it.each(combos)('answers as before for ideation to audio: %o', (combo) => {
    const stages = deriveStages({
      status: 'draft',
      storyData: combo.story ? { logline: 'x' } : null,
      screenplayData: combo.screenplay ? { scenes: [] } : null,
      shotList: null,
      finalVideoUrl: null,
      shotCount: combo.shots ? 2 : 0,
      dialogueLineCount: 0,
      audioCueCount: combo.audio ? 1 : 0,
      origin: null,
    });

    expect(
      Object.fromEntries(
        stages
          .filter((stage) => stage.key !== 'publish')
          .map((stage) => [stage.key, stage.state]),
      ),
    ).toEqual(before(combo));
  });

  const base: Parameters<typeof deriveStages>[0] = {
    status: 'draft',
    storyData: null,
    screenplayData: null,
    shotList: null,
    finalVideoUrl: null,
    shotCount: 0,
    dialogueLineCount: 0,
    audioCueCount: 0,
    origin: null,
  };
  const publishOf = (input: typeof base) =>
    deriveStages(input).find((stage) => stage.key === 'publish')?.state;

  it('opens publish when there is a video to publish, not when shots exist', () => {
    expect(publishOf({ ...base, shotCount: 3 })).toBe('locked');
    expect(publishOf({ ...base, finalVideoUrl: 'https://cdn/final.mp4' })).toBe(
      'available',
    );
  });

  it('calls publish done once the episode is published', () => {
    expect(
      publishOf({
        ...base,
        status: 'published',
        finalVideoUrl: 'https://cdn/final.mp4',
      }),
    ).toBe('done');
  });
});

describe('get_screenplay', () => {
  const scenes = Array.from({ length: 5 }, (_, i) => ({
    number: i + 1,
    heading: `SCENE ${i + 1}`,
    location: 'Hall',
    timeOfDay: 'day',
    description: 'd',
    dialogue: [],
    estimatedDuration: 10,
  }));

  const episode = {
    id: EPISODE_ID,
    title: 'Two',
    screenplay_data: { scenes, metadata: { totalScenes: 5 } },
    deleted_at: null,
    project: { account_id: ACCOUNT_ID },
  };

  it('pages by scene with cursor and limit', async () => {
    const fake = createFakeClient({ episodes: [episode] });
    const context = fakeContext(fake.client);

    const page1 = await getScreenplayTool.handler(
      { episodeId: EPISODE_ID, limit: 2, cursor: undefined },
      context,
    );
    const scenes1 = page1.structuredContent.scenes as Array<{ number: number }>;
    expect(scenes1.map((s) => s.number)).toEqual([1, 2]);
    expect(page1.structuredContent.nextCursor).toBeTypeOf('string');
    expect(page1.structuredContent.totalScenes).toBe(5);

    const page2 = await getScreenplayTool.handler(
      {
        episodeId: EPISODE_ID,
        limit: 2,
        cursor: page1.structuredContent.nextCursor as string,
      },
      context,
    );
    expect(
      (page2.structuredContent.scenes as Array<{ number: number }>).map(
        (s) => s.number,
      ),
    ).toEqual([3, 4]);

    const page3 = await getScreenplayTool.handler(
      {
        episodeId: EPISODE_ID,
        limit: 2,
        cursor: page2.structuredContent.nextCursor as string,
      },
      context,
    );
    expect(
      (page3.structuredContent.scenes as Array<{ number: number }>).map(
        (s) => s.number,
      ),
    ).toEqual([5]);
    expect(page3.structuredContent.nextCursor).toBeNull();
  });

  it('says when there is no screenplay yet instead of returning an empty list silently', async () => {
    const fake = createFakeClient({
      episodes: [{ ...episode, screenplay_data: null }],
    });

    const result = await getScreenplayTool.handler(
      { episodeId: EPISODE_ID, limit: 10, cursor: undefined },
      fakeContext(fake.client),
    );

    expect(result.structuredContent.scenes).toEqual([]);
    expect(result.structuredContent.note).toMatch(/no screenplay/i);
  });
});
