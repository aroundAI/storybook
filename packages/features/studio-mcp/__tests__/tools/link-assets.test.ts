import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  type Ctx,
  type EpisodeContextSnapshot,
  screenplayStage,
} from '@kit/generation';
import {
  type RecordedCall as StepCall,
  recordingClient,
  tableResponder,
} from '@kit/generation/testing';

import { authorTools } from '../../src/server/tools/author';
import { linkAssetsToEpisodeTool } from '../../src/server/tools/author/link-assets';
import {
  type RecordedCall,
  createFakeClient,
  fakeContext,
} from '../helpers/fake-supabase';

const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_PROJECT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EPISODE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MAYA_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const DECK_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
const FOREIGN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc03';

const MAYA = {
  id: MAYA_ID,
  name: 'Maya Chen',
  type: 'character',
  project_id: PROJECT_ID,
  deleted_at: null,
};
const DECK = {
  id: DECK_ID,
  name: 'Observation Deck',
  type: 'location',
  project_id: PROJECT_ID,
  deleted_at: null,
};
const FOREIGN = {
  id: FOREIGN_ID,
  name: 'Their Hero',
  type: 'character',
  project_id: OTHER_PROJECT_ID,
  deleted_at: null,
};

const episodeRow = (metadata: Record<string, unknown> = {}) => ({
  id: EPISODE_ID,
  project_id: PROJECT_ID,
  version: 4,
  metadata,
  project: { id: PROJECT_ID, account_id: ACCOUNT_ID },
});

function clientFor(assets: unknown[], metadata: Record<string, unknown> = {}) {
  return createFakeClient({
    episodes: (call: RecordedCall) =>
      call.op === 'update'
        ? { data: [{ id: EPISODE_ID }] }
        : { data: episodeRow(metadata) },
    assets,
  });
}

function writtenMetadata(calls: RecordedCall[]) {
  const update = calls.find(
    (call) => call.table === 'episodes' && call.op === 'update',
  );

  return (update?.payload as { metadata: Record<string, unknown> } | undefined)
    ?.metadata;
}

describe('link_assets_to_episode input', () => {
  const schema = z.object(linkAssetsToEpisodeTool.inputSchema);

  it('needs an episode id and one to fifty asset uuids', () => {
    const ids = (n: number) =>
      Array.from(
        { length: n },
        (_, i) => `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, '0')}`,
      );

    expect(
      schema.safeParse({ episodeId: 'nope', assetIds: ids(1) }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ episodeId: EPISODE_ID, assetIds: [] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ episodeId: EPISODE_ID, assetIds: ['nope'] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ episodeId: EPISODE_ID, assetIds: ids(50) }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ episodeId: EPISODE_ID, assetIds: ids(51) }).success,
    ).toBe(false);
  });

  it('is a studio:write tool, registered with the author tools, and takes no team id', () => {
    expect(linkAssetsToEpisodeTool.scope).toBe('studio:write');
    expect(linkAssetsToEpisodeTool.annotations.readOnlyHint).toBe(false);
    expect(authorTools.map((tool) => tool.name)).toContain(
      'link_assets_to_episode',
    );
    expect('accountId' in linkAssetsToEpisodeTool.inputSchema).toBe(false);
  });
});

describe('link_assets_to_episode', () => {
  it('writes the ids and names the web header writes, keeping what was linked already', async () => {
    const fake = clientFor([MAYA, DECK], {
      character_ids: ['existing-id'],
      character_names: ['Houston'],
      visual_tone: 'noir',
    });

    const result = await linkAssetsToEpisodeTool.handler(
      { episodeId: EPISODE_ID, assetIds: [MAYA_ID, DECK_ID] },
      fakeContext(fake.client),
    );

    expect(writtenMetadata(fake.calls)).toEqual({
      character_ids: ['existing-id', MAYA_ID],
      character_names: ['Houston', 'Maya Chen'],
      location_ids: [DECK_ID],
      location_names: ['Observation Deck'],
      visual_tone: 'noir',
    });
    expect(result.structuredContent.linked).toEqual([
      { id: MAYA_ID, name: 'Maya Chen', type: 'character' },
      { id: DECK_ID, name: 'Observation Deck', type: 'location' },
    ]);
  });

  it('linking the same asset again changes nothing', async () => {
    const fake = clientFor([MAYA], {
      character_ids: [MAYA_ID],
      character_names: ['maya chen'],
    });

    await linkAssetsToEpisodeTool.handler(
      { episodeId: EPISODE_ID, assetIds: [MAYA_ID] },
      fakeContext(fake.client),
    );

    expect(writtenMetadata(fake.calls)).toEqual({
      character_ids: [MAYA_ID],
      character_names: ['maya chen'],
    });
  });

  it("refuses another team's asset, and writes nothing", async () => {
    const fake = clientFor([MAYA, FOREIGN]);

    await expect(
      linkAssetsToEpisodeTool.handler(
        { episodeId: EPISODE_ID, assetIds: [MAYA_ID, FOREIGN_ID] },
        fakeContext(fake.client),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining(FOREIGN_ID),
    });

    expect(writtenMetadata(fake.calls)).toBeUndefined();
  });

  it('refuses an id RLS hides, which reads as no row, and writes nothing', async () => {
    const fake = clientFor([MAYA]);

    await expect(
      linkAssetsToEpisodeTool.handler(
        { episodeId: EPISODE_ID, assetIds: [MAYA_ID, FOREIGN_ID] },
        fakeContext(fake.client),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    expect(writtenMetadata(fake.calls)).toBeUndefined();
  });

  it('refuses an episode outside the connection’s team', async () => {
    // The database filters on the project's account and answers no row.
    const none = createFakeClient({ episodes: null, assets: [MAYA] });

    await expect(
      linkAssetsToEpisodeTool.handler(
        { episodeId: EPISODE_ID, assetIds: [MAYA_ID] },
        fakeContext(none.client),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(writtenMetadata(none.calls)).toBeUndefined();
  });
});

describe('a screenplay that names the team’s existing cast (KB-183)', () => {
  const scene = {
    number: 1,
    heading: 'INT. OBSERVATION DECK - DAY',
    location: 'Observation Deck',
    timeOfDay: 'day' as const,
    description: 'Maya floats at the window.',
    dialogue: [{ character: 'Maya Chen', text: '[calm] Houston, respond.' }],
    estimatedDuration: 30,
  };

  /** The context loader's rule: the episode's linked ids select the assets. */
  function worldFrom(metadata: Record<string, unknown> | undefined) {
    const pick = (ids: unknown, rows: Array<{ id: string; name: string }>) =>
      rows.filter((row) => ((ids as string[]) ?? []).includes(row.id));
    const characterList = pick(metadata?.character_ids, [MAYA]);
    const locationList = pick(metadata?.location_ids, [DECK]);

    return {
      characters: characterList.map((c) => `Name: ${c.name}`).join('\n'),
      locations: locationList.map((l) => `- **${l.name}**`).join('\n'),
      counts: {
        characters: characterList.length,
        locations: locationList.length,
      },
      characterList,
      locationList,
      previousEpisodes: '',
      recurringElements: '',
      episodeNumber: 1,
    } as unknown as EpisodeContextSnapshot;
  }

  async function check(metadata: Record<string, unknown> | undefined) {
    const supabase = recordingClient(
      tableResponder({
        episodes: {
          id: EPISODE_ID,
          number: 1,
          title: 'Signal',
          version: 4,
          status: 'story',
          story_data: {
            fullStory: 'Maya hears her own voice.',
            tone: 'tense',
            actBreakdown: { act1: 'a', act2: 'b', act3: 'c' },
            themes: [],
            characters: [],
            keyEvents: [],
            estimatedSceneCount: 1,
          },
          target_duration_seconds: 60,
          project: { id: PROJECT_ID, account_id: ACCOUNT_ID, metadata: {} },
        },
      }) as (call: StepCall) => never,
    );
    const ctx: Ctx = {
      client: supabase.client,
      accountId: ACCOUNT_ID,
      userId: 'u',
      episodeContext: async () => worldFrom(metadata),
    };

    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    return screenplayStage.check(
      ctx,
      { episodeId: EPISODE_ID },
      { scenes: [scene] },
      { key: 'scene-1', index: 0, total: 1, label: 'x' },
    );
  }

  it('is refused before the assets are linked and accepted after link_assets_to_episode', async () => {
    expect((await check({})).map((e) => e.code)).toEqual([
      'unknown_location',
      'unknown_character',
    ]);

    const fake = clientFor([MAYA, DECK]);
    await linkAssetsToEpisodeTool.handler(
      { episodeId: EPISODE_ID, assetIds: [MAYA_ID, DECK_ID] },
      fakeContext(fake.client),
    );

    expect(await check(writtenMetadata(fake.calls))).toEqual([]);
  });
});
