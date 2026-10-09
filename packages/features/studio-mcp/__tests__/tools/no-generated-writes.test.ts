import { describe, expect, it } from 'vitest';

import { authorTools } from '../../src/server/tools/author';
import { upsertAssetTool } from '../../src/server/tools/author/assets';
import {
  createEpisodeTool,
  updateEpisodeTool,
} from '../../src/server/tools/author/episodes';
import {
  createProjectTool,
  updateProjectTool,
} from '../../src/server/tools/author/projects';
import {
  type RecordedCall,
  createFakeClient,
  fakeContext,
} from '../helpers/fake-supabase';

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EPISODE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ASSET_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/**
 * FILM-1905 criterion: no author tool writes story_data, screenplay_data,
 * shots, dialogue_lines or audio_cues. Generated content goes through
 * FILM-1908's brief and submit path only.
 */
const GENERATED_COLUMNS = [
  'story_data',
  'storyData',
  'screenplay_data',
  'screenplayData',
  'shot_list',
  'shotList',
  'shots',
  'dialogue_lines',
  'dialogueLines',
  'audio_cues',
  'audioCues',
];

const GENERATED_TABLES = ['shots', 'dialogue_lines', 'audio_cues'];

function writtenKeys(calls: RecordedCall[]) {
  return calls
    .filter(
      (call) =>
        call.op === 'insert' || call.op === 'update' || call.op === 'upsert',
    )
    .flatMap((call) => {
      const payload = call.payload;

      if (Array.isArray(payload)) {
        return payload.flatMap((row) => Object.keys(row as object));
      }

      return payload ? Object.keys(payload as object) : [];
    });
}

describe('author tools never carry generated-content inputs', () => {
  it.each(authorTools.map((tool) => [tool.name, tool] as const))(
    '%s has no generated-content key in its input schema',
    (_name, tool) => {
      const keys = Object.keys(tool.inputSchema);

      for (const forbidden of GENERATED_COLUMNS) {
        expect(keys).not.toContain(forbidden);
      }
    },
  );

  it('registers exactly the author tools, all studio:write and not read-only', () => {
    expect(authorTools.map((tool) => tool.name).sort()).toEqual(
      [
        'create_episode',
        'create_project',
        'link_assets_to_episode',
        'update_episode',
        'update_project',
        'upsert_asset',
        // FILM-2204
        'create_season',
        'update_season',
        'reorder_seasons',
        'delete_season',
        'set_stage_skipped',
        'import_screenplay',
        'request_episode_video_upload',
        'finalize_episode_video',
        'link_published_video',
      ].sort(),
    );

    for (const tool of authorTools) {
      expect(tool.scope).toBe('studio:write');
      expect(tool.annotations.readOnlyHint).toBe(false);
      // Deleting a season deletes it (its episodes move to Unsorted)
      expect(tool.annotations.destructiveHint).toBe(
        tool.name === 'delete_season',
      );
    }
  });
});

describe('author tool handlers never touch generated content', () => {
  const project = {
    id: PROJECT_ID,
    account_id: '22222222-2222-4222-8222-222222222222',
    name: 'P',
    slug: 'p',
    description: null,
    status: 'active',
    metadata: {},
    created_at: '2026-10-03T00:00:00Z',
    updated_at: '2026-10-03T00:00:00Z',
  };

  const episode = {
    id: EPISODE_ID,
    project_id: PROJECT_ID,
    season_id: null,
    number: 1,
    slug: 'ep-1',
    title: 'Ep',
    description: null,
    status: 'draft',
    version: 1,
    metadata: {},
    target_duration_seconds: null,
    deleted_at: null,
    created_at: '2026-10-03T00:00:00Z',
    updated_at: '2026-10-03T00:00:00Z',
    project: { account_id: project.account_id },
  };

  it('create_project inserts only into projects', async () => {
    const fake = createFakeClient({ projects: [project] });

    await createProjectTool.handler(
      { name: 'P', description: undefined, slug: undefined },
      fakeContext(fake.client),
    );

    expect(fake.tables()).toContain('projects');
    for (const table of GENERATED_TABLES) {
      expect(fake.tables()).not.toContain(table);
    }
  });

  it('update_project updates only projects, and merges settings into metadata', async () => {
    const fake = createFakeClient({ projects: [project] });

    await updateProjectTool.handler(
      { projectId: PROJECT_ID, name: 'Renamed', genre: 'drama' } as never,
      fakeContext(fake.client),
    );

    const tables = fake.tables();
    expect(tables.every((table) => table === 'projects')).toBe(true);

    const update = fake.calls.find((call) => call.op === 'update');
    expect(update?.payload).toMatchObject({
      name: 'Renamed',
      metadata: { genre: 'drama' },
    });
  });

  it('create_episode inserts an episode without story_data, screenplay_data or shot_list', async () => {
    const fake = createFakeClient({
      episodes: (call) =>
        call.op === 'insert'
          ? { data: [{ ...episode, title: 'New' }] }
          : { data: [] },
      projects: [project],
    });

    await createEpisodeTool.handler(
      {
        projectId: PROJECT_ID,
        title: 'New',
        description: 'A logline',
        targetDuration: 300,
        contentStyle: 'balanced',
      } as never,
      fakeContext(fake.client),
    );

    const insert = fake.calls.find(
      (call) => call.table === 'episodes' && call.op === 'insert',
    );
    expect(insert).toBeDefined();
    expect(insert?.payload).toMatchObject({
      title: 'New',
      description: 'A logline',
      status: 'draft',
      target_duration_seconds: 300,
      metadata: { content_style: 'balanced', target_duration: 300 },
    });

    for (const key of writtenKeys(fake.calls)) {
      expect(GENERATED_COLUMNS).not.toContain(key);
    }
    for (const table of GENERATED_TABLES) {
      expect(fake.tables()).not.toContain(table);
    }
  });

  it('update_episode updates title, description and creative direction only', async () => {
    const fake = createFakeClient({
      projects: [project],
      episodes: (call) =>
        call.op === 'update'
          ? { data: [{ ...episode, title: 'Renamed', version: 2 }] }
          : { data: [episode] },
    });

    await updateEpisodeTool.handler(
      {
        episodeId: EPISODE_ID,
        version: 1,
        title: 'Renamed',
        targetDuration: 600,
      } as never,
      fakeContext(fake.client),
    );

    const update = fake.calls.find(
      (call) => call.table === 'episodes' && call.op === 'update',
    );
    expect(update).toBeDefined();
    expect(update?.payload).toMatchObject({
      title: 'Renamed',
      target_duration_seconds: 600,
    });
    expect(
      update?.filters.some(
        (filter) => filter.method === 'eq' && filter.args[0] === 'version',
      ),
    ).toBe(true);

    for (const key of writtenKeys(fake.calls)) {
      expect(GENERATED_COLUMNS).not.toContain(key);
    }
    for (const table of GENERATED_TABLES) {
      expect(fake.tables()).not.toContain(table);
    }
  });

  it('upsert_asset writes characters through the character functions and locations into assets', async () => {
    const characterRow = {
      id: ASSET_ID,
      project_id: PROJECT_ID,
      type: 'character',
      name: 'Ada',
      description: null,
      file_url: null,
      thumbnail_url: null,
      metadata: {},
      episode_id: null,
      deleted_at: null,
      created_at: '2026-10-03T00:00:00Z',
      updated_at: '2026-10-03T00:00:00Z',
      character_details: [
        {
          physical_attributes: null,
          personality: null,
          element_prompt: null,
          reference_images: null,
          elevenlabs_voice_id: null,
        },
      ],
    };

    const fake = createFakeClient({
      projects: [project],
      assets: (call) =>
        call.op === 'select' && call.columns?.includes('character_details')
          ? { data: [characterRow] }
          : { data: [] },
      'rpc:create_character_with_details': () => ({ data: ASSET_ID }),
    });

    await upsertAssetTool.handler(
      {
        projectId: PROJECT_ID,
        type: 'character',
        name: 'Ada',
        character: { personality: 'Dry wit' },
      } as never,
      fakeContext(fake.client),
    );

    expect(fake.tables()).toContain('rpc:create_character_with_details');

    const locationFake = createFakeClient({
      projects: [project],
      assets: (call) =>
        call.op === 'insert'
          ? {
              data: [
                {
                  ...characterRow,
                  type: 'location',
                  name: 'Pier',
                  id: ASSET_ID,
                },
              ],
            }
          : { data: [] },
    });

    await upsertAssetTool.handler(
      {
        projectId: PROJECT_ID,
        type: 'location',
        name: 'Pier',
        location: { setting: 'coastal' },
      } as never,
      fakeContext(locationFake.client),
    );

    const insert = locationFake.calls.find((call) => call.op === 'insert');
    expect(insert?.table).toBe('assets');
    expect(insert?.payload).toMatchObject({
      type: 'location',
      name: 'Pier',
      metadata: { setting: 'coastal' },
    });

    for (const table of GENERATED_TABLES) {
      expect(fake.tables()).not.toContain(table);
      expect(locationFake.tables()).not.toContain(table);
    }
  });
});
