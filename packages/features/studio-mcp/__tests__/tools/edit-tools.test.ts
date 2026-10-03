import { describe, expect, it } from 'vitest';

import {
  type EpisodeContextSnapshot,
  type ShotsEpisode,
  buildShotRows,
} from '@kit/generation';

import { McpToolError } from '../../src/errors';
import {
  type EditCommitRequest,
  type EditToolDeps,
  type EditWrite,
  createEditTools,
  shotColumns,
} from '../../src/server/tools/edit';
import { contextFor, fakeClient } from '../helpers/fake-postgrest';

/**
 * FILM-1909: edit_scene, edit_shot and edit_dialogue_line, each validated
 * with its stage's own output schema and check(), versioned, and mapped to
 * the commit plan a run applies. The writer is a fake that records what it
 * was asked to apply; the real one is FILM-1903's apply_generation_commit.
 */
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EPISODE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SHOT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LINE = (n: number) => `dddddddd-dddd-4ddd-8ddd-00000000000${n}`;
const MARA = 'eeeeeeee-eeee-4eee-8eee-000000000001';
const JON = 'eeeeeeee-eeee-4eee-8eee-000000000002';
const NOW = new Date('2026-10-03T12:00:00.000Z');

function scenes() {
  return [
    {
      number: 1,
      heading: 'INT. KITCHEN - MORNING',
      location: 'Kitchen',
      timeOfDay: 'morning',
      description: 'Mara burns the toast.',
      dialogue: [
        { character: 'Mara', text: 'Not again.' },
        { character: 'Jon', text: 'Again.' },
      ],
      estimatedDuration: 30,
      hookOut: 'The smoke alarm.',
    },
    {
      number: 2,
      heading: 'EXT. GARDEN - MIDDAY',
      location: 'Garden',
      timeOfDay: 'midday',
      description: 'They eat outside.',
      dialogue: [
        { character: 'Jon', text: 'Better.' },
        { character: 'Mara', text: 'Much.' },
      ],
      estimatedDuration: 20,
    },
  ];
}

const VEO = {
  shotLine: 'SHOT: Medium, static',
  timeline: [
    {
      startTime: '00:00',
      endTime: '00:03',
      type: 'action' as const,
      character: 'Mara',
      content: 'Mara scrapes the toast.',
    },
  ],
  audio: 'AUDIO: scraping, kettle',
  style: 'STYLE: warm morning light',
  avoid: 'AVOID: subtitles, captions, watermarks',
  fullPrompt: 'Medium shot. Mara scrapes burnt toast.',
};

function episodeRow(version = 7) {
  return {
    id: EPISODE,
    number: 3,
    title: 'Toast',
    version,
    status: 'storyboard',
    deleted_at: null,
    target_duration_seconds: 60,
    shot_list: null,
    story_data: { fullStory: 'Mara and Jon fight over breakfast.' },
    screenplay_data: {
      scenes: scenes(),
      metadata: { locations: ['Kitchen', 'Garden'], keep: 'me' },
      generatedBy: { model: 'screenplay-orchestrator' },
    },
    project: {
      id: PROJECT,
      account_id: ACCOUNT,
      name: 'Breakfast',
      slug: 'breakfast',
      metadata: {},
    },
  };
}

function lineRows() {
  return [
    [1, 1, 'Not again.', MARA, 'https://audio/1.mp3'],
    [2, 1, 'Again.', JON, null],
    [3, 2, 'Better.', JON, null],
    [4, 2, 'Much.', MARA, 'https://audio/4.mp3'],
  ].map(([n, scene, text, speaker, audio]) => ({
    id: LINE(n as number),
    scene_number: scene,
    sequence_number: n,
    language: 'en',
    text,
    character_asset_id: speaker,
    audio_url: audio,
  }));
}

function shotRow() {
  return {
    id: SHOT,
    scene_number: 1,
    shot_number: 2,
    sequence_number: 2,
    scene_description: 'Mara scrapes the toast.',
    duration_seconds: 5,
    camera_direction: 'static',
    generation_metadata: {
      shotType: 'medium',
      location: 'Kitchen',
      timeOfDay: 'morning',
      mood: 'wry',
      characters: ['Mara'],
      veoPrompt: VEO,
      isReelCandidate: true,
    },
    transition_type: 'cut',
    frame_strategy: 'character_focus',
    primary_subject: { type: 'character', name: 'Mara' },
    first_frame_description: 'Mara at the counter.',
    last_frame_description: 'Toast in the bin.',
    location_area: 'counter',
    location_environment_description: 'A small kitchen.',
  };
}

const snapshot: EpisodeContextSnapshot = {
  episodeNumber: 3,
  characters: 'Mara; Jon',
  locations: 'Kitchen; Garden',
  previousEpisodes: '',
  counts: { characters: 2, locations: 2 },
  characterNames: ['Mara', 'Jon'],
  locationNames: ['Kitchen', 'Garden'],
  characterList: [
    { id: MARA, name: 'Mara' },
    { id: JON, name: 'Jon' },
  ],
  locationList: [
    { id: 'l1', name: 'Kitchen' },
    { id: 'l2', name: 'Garden' },
  ],
};

function harness(options: { version?: number; lines?: unknown[] } = {}) {
  const fake = fakeClient({
    episodes: [episodeRow(options.version)],
    dialogue_lines: (options.lines ?? lineRows()).map((row) => ({
      episode_id: EPISODE,
      ...(row as object),
    })),
    shots: [{ ...shotRow(), episode_id: EPISODE, deleted_at: null }],
  });
  const commits: EditCommitRequest[] = [];
  const deps: EditToolDeps = {
    writer: {
      async commit(request) {
        commits.push(request);
        return {
          version: request.targetVersion + 1,
          runId: 'run-1',
          revisionId: 'rev-1',
        };
      },
    },
    episodeContext: () => async () => snapshot,
    now: () => NOW,
  };
  const tools = createEditTools(() => deps);
  const base = contextFor(fake, { id: ACCOUNT, slug: 'team-a' });
  const context = {
    ...base,
    principal: {
      ...base.principal,
      userId: '11111111-1111-4111-8111-111111111111',
    },
  };

  return { fake, commits, tools, context };
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to be refused');
    },
    (e: unknown) => e,
  );

  expect(error).toBeInstanceOf(McpToolError);

  return error as McpToolError;
}

interface WrittenScreenplay {
  scenes: Array<Record<string, unknown> & { dialogue: unknown[] }>;
  metadata: Record<string, unknown>;
  generatedBy: unknown;
}

/** The screenplay an episodes update writes. */
function screenplayOf(op: EditWrite | undefined): WrittenScreenplay {
  if (op?.op !== 'update' || op.table !== 'episodes') {
    throw new Error('expected the episodes update');
  }

  return op.values.screenplay_data as WrittenScreenplay;
}

function writesTo(ops: EditWrite[], table: string) {
  return ops.filter((op) => op.table === table);
}

describe('edit_scene', () => {
  it('replaces one scene in the screenplay, under the run for screenplay_refinement at the version read', async () => {
    const { tools, commits, context } = harness();

    const result = await tools.editSceneTool.handler(
      {
        episodeId: EPISODE,
        version: 7,
        sceneNumber: 1,
        heading: 'INT. KITCHEN - DAWN',
        timeOfDay: 'dawn',
      },
      context,
    );

    expect(commits).toHaveLength(1);
    const [commit] = commits;
    expect(commit).toMatchObject({
      stage: 'screenplay_refinement',
      episodeId: EPISODE,
      projectId: PROJECT,
      accountId: ACCOUNT,
      targetVersion: 7,
      origin: { kind: 'external', clientName: 'test', at: NOW.toISOString() },
    });

    const [episodeWrite, ...rest] = commit!.plan.ops;
    expect(rest).toEqual([]);
    expect(episodeWrite).toMatchObject({
      table: 'episodes',
      op: 'update',
      requireRows: true,
      match: [
        { column: 'id', op: 'eq', value: EPISODE },
        { column: 'deleted_at', op: 'is', value: null },
      ],
    });

    const written = screenplayOf(episodeWrite);
    expect(written.scenes[0]).toMatchObject({
      number: 1,
      heading: 'INT. KITCHEN - DAWN',
      timeOfDay: 'dawn',
      hookOut: 'The smoke alarm.',
      generationOrigin: { kind: 'external' },
    });
    expect(written.scenes[1]).toEqual(scenes()[1]);
    expect(written.generatedBy).toEqual({ model: 'screenplay-orchestrator' });
    expect(written.metadata).toMatchObject({
      keep: 'me',
      totalScenes: 2,
      characters: ['Mara', 'Jon'],
      estimatedDuration: 50,
    });
    expect(result.structuredContent).toMatchObject({
      version: 8,
      runId: 'run-1',
      revisionId: 'rev-1',
      dialogue: { mode: 'unchanged' },
    });
  });

  it('edits changed lines in place when the scene keeps its line count; a voiced line goes back to pending', async () => {
    const { tools, commits, context } = harness();

    const result = await tools.editSceneTool.handler(
      {
        episodeId: EPISODE,
        version: 7,
        sceneNumber: 1,
        dialogue: [
          { character: 'Mara', text: 'Not AGAIN.' },
          { character: 'Jon', text: 'Again.' },
        ],
      },
      context,
    );

    const lines = writesTo(commits[0]!.plan.ops, 'dialogue_lines');
    expect(lines).toEqual([
      {
        table: 'dialogue_lines',
        op: 'update',
        values: {
          text: 'Not AGAIN.',
          character_asset_id: MARA,
          status: 'pending',
          generation_origin: expect.objectContaining({ kind: 'external' }),
        },
        match: [{ column: 'id', op: 'eq', value: LINE(1) }],
        requireRows: true,
      },
    ]);
    expect(result.structuredContent.dialogue).toEqual({
      mode: 'in_place',
      linesUpdated: 1,
      voiceRendersInvalidated: 1,
    });
  });

  it('rebuilds the episode lines as the screenplay commit does when the scene gains a line', async () => {
    const { tools, commits, context } = harness({
      lines: [
        ...lineRows(),
        {
          id: 'translated',
          scene_number: 1,
          sequence_number: 1,
          language: 'es',
          text: 'Otra vez no.',
          character_asset_id: MARA,
          audio_url: null,
        },
      ],
    });

    const result = await tools.editSceneTool.handler(
      {
        episodeId: EPISODE,
        version: 7,
        sceneNumber: 1,
        dialogue: [
          { character: 'Mara', text: 'Not again.' },
          { character: 'Jon', text: 'Again.' },
          { character: 'Mara', text: 'Fine.' },
        ],
      },
      context,
    );

    const ops = writesTo(commits[0]!.plan.ops, 'dialogue_lines');
    expect(ops[0]).toEqual({
      table: 'dialogue_lines',
      op: 'delete',
      match: [{ column: 'episode_id', op: 'eq', value: EPISODE }],
    });
    const inserted = (ops[1] as { rows: Array<Record<string, unknown>> }).rows;
    expect(
      inserted.map((row) => [
        row.sequence_number,
        row.scene_number,
        row.text,
        row.character_asset_id,
      ]),
    ).toEqual([
      [1, 1, 'Not again.', MARA],
      [2, 1, 'Again.', JON],
      [3, 1, 'Fine.', MARA],
      [4, 2, 'Better.', JON],
      [5, 2, 'Much.', MARA],
    ]);
    expect(
      inserted.every(
        (row) => row.language === 'en' && row.status === 'pending',
      ),
    ).toBe(true);
    expect(result.structuredContent.dialogue).toEqual({
      mode: 'rebuilt',
      linesWritten: 5,
      voiceRendersInvalidated: 2,
      translationsRemoved: 1,
    });
  });

  it("refuses a speaker the episode does not have, with the stage check's path and code, and writes nothing", async () => {
    const { tools, commits, context } = harness();

    const error = await refusal(
      tools.editSceneTool.handler(
        {
          episodeId: EPISODE,
          version: 7,
          sceneNumber: 1,
          dialogue: [{ character: 'Zed', text: 'Who?' }],
        },
        context,
      ),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details?.errors).toEqual([
      expect.objectContaining({
        path: 'scenes.0.dialogue.0.character',
        code: 'unknown_character',
      }),
    ]);
    expect(commits).toEqual([]);
  });

  it('accepts that speaker once it is declared new', async () => {
    const { tools, commits, context } = harness();

    await tools.editSceneTool.handler(
      {
        episodeId: EPISODE,
        version: 7,
        sceneNumber: 1,
        dialogue: [{ character: 'Zed', text: 'Who?' }],
        newCharacters: ['Zed'],
      },
      context,
    );

    expect(commits).toHaveLength(1);
  });

  it('refuses a stale version with TARGET_CHANGED before checking or writing', async () => {
    const { tools, commits, context } = harness({ version: 9 });

    const error = await refusal(
      tools.editSceneTool.handler(
        { episodeId: EPISODE, version: 7, sceneNumber: 1, heading: 'X' },
        context,
      ),
    );

    expect(error.code).toBe('TARGET_CHANGED');
    expect(error.details).toEqual({
      episodeId: EPISODE,
      version: 7,
      currentVersion: 9,
    });
    expect(commits).toEqual([]);
  });

  it('refuses a blank heading through the stage check and a scene that does not exist as NOT_FOUND', async () => {
    const { tools, context } = harness();

    const blank = await refusal(
      tools.editSceneTool.handler(
        { episodeId: EPISODE, version: 7, sceneNumber: 2, heading: '  ' },
        context,
      ),
    );
    expect(blank.details?.errors).toEqual([
      expect.objectContaining({
        path: 'scenes.0.heading',
        code: 'empty_heading',
      }),
    ]);

    const missing = await refusal(
      tools.editSceneTool.handler(
        { episodeId: EPISODE, version: 7, sceneNumber: 5, heading: 'X' },
        context,
      ),
    );
    expect(missing.code).toBe('NOT_FOUND');
  });
});

describe('edit_dialogue_line', () => {
  it('changes the line in the screenplay and its row together', async () => {
    const { tools, commits, context } = harness();

    const result = await tools.editDialogueLineTool.handler(
      {
        episodeId: EPISODE,
        version: 7,
        dialogueLineId: LINE(4),
        text: 'So much.',
      },
      context,
    );

    const [episodeWrite, lineWrite] = commits[0]!.plan.ops;
    const written = screenplayOf(episodeWrite);
    expect(written.scenes[1]!.dialogue).toEqual([
      { character: 'Jon', text: 'Better.' },
      { character: 'Mara', text: 'So much.' },
    ]);
    expect(lineWrite).toEqual({
      table: 'dialogue_lines',
      op: 'update',
      values: {
        text: 'So much.',
        character_asset_id: MARA,
        status: 'pending',
        generation_origin: expect.objectContaining({ kind: 'external' }),
      },
      match: [{ column: 'id', op: 'eq', value: LINE(4) }],
      requireRows: true,
    });
    expect(commits[0]!.stage).toBe('screenplay_refinement');
    expect(result.structuredContent.voiceRenderInvalidated).toBe(true);
  });

  it('refuses a translated line and an unknown speaker', async () => {
    const { tools, context } = harness({
      lines: [
        ...lineRows(),
        {
          id: LINE(9),
          scene_number: 1,
          sequence_number: 1,
          language: 'es',
          text: 'Otra vez no.',
          character_asset_id: MARA,
          audio_url: null,
        },
      ],
    });

    const translated = await refusal(
      tools.editDialogueLineTool.handler(
        { episodeId: EPISODE, version: 7, dialogueLineId: LINE(9), text: 'x' },
        context,
      ),
    );
    expect(translated.code).toBe('VALIDATION_FAILED');

    const stranger = await refusal(
      tools.editDialogueLineTool.handler(
        {
          episodeId: EPISODE,
          version: 7,
          dialogueLineId: LINE(2),
          character: 'Zed',
        },
        context,
      ),
    );
    expect(stranger.details?.errors).toEqual([
      expect.objectContaining({ code: 'unknown_character' }),
    ]);
  });
});

describe('edit_shot', () => {
  it("updates the shot's row in place, as the shots commit maps a shot, and touches the episode so its version moves", async () => {
    const { tools, commits, context } = harness();

    await tools.editShotTool.handler(
      {
        episodeId: EPISODE,
        version: 7,
        shotId: SHOT,
        durationSeconds: 7.4,
        veoPrompt: { fullPrompt: 'Close on Mara scraping burnt toast.' },
      },
      context,
    );

    const [commit] = commits;
    expect(commit!.stage).toBe('shots');
    const [shotWrite, episodeWrite] = commit!.plan.ops;
    expect(shotWrite).toMatchObject({
      table: 'shots',
      op: 'update',
      requireRows: true,
      match: [
        { column: 'id', op: 'eq', value: SHOT },
        { column: 'episode_id', op: 'eq', value: EPISODE },
        { column: 'deleted_at', op: 'is', value: null },
      ],
      values: {
        prompt: 'Close on Mara scraping burnt toast.',
        duration_seconds: 7,
        generation_metadata: expect.objectContaining({
          isReelCandidate: true,
          veoPrompt: {
            ...VEO,
            fullPrompt: 'Close on Mara scraping burnt toast.',
          },
        }),
        generation_origin: expect.objectContaining({ kind: 'external' }),
      },
    });
    expect(episodeWrite).toMatchObject({
      table: 'episodes',
      op: 'update',
      values: { updated_at: NOW.toISOString() },
    });
  });

  it('writes the columns the shots commit writes for the same shot', () => {
    const shot = {
      shotNumber: 1,
      shotType: 'medium' as const,
      cameraDirection: 'static',
      description: 'Mara scrapes the toast.',
      characters: ['Mara'],
      duration: 5.6,
      transitionType: 'cut' as const,
      frameStrategy: 'character_focus' as const,
      primarySubject: { type: 'character' as const, name: 'Mara' },
      firstFrameDescription: 'Mara at the counter.',
      lastFrameDescription: 'Toast in the bin.',
      locationArea: 'counter',
      locationEnvironmentDescription: 'A small kitchen.',
      veoPrompt: VEO,
      metadata: {
        location: 'Kitchen',
        timeOfDay: 'morning' as const,
        mood: 'wry',
      },
    };
    const episode = {
      id: EPISODE,
      scenes: [{ number: 1 }],
    } as unknown as ShotsEpisode;
    const { rows } = buildShotRows(
      episode,
      undefined,
      [
        {
          kind: 'scene',
          sceneNumber: 1,
          shots: [shot],
          sceneSummary: '',
          sceneViralScore: 1,
        },
      ],
      1,
    );
    const { generation_metadata: committed, ...fromCommit } = rows[0]!;
    const { generation_metadata: edited, ...fromEdit } = shotColumns(shot, {
      isReelCandidate: false,
    });

    for (const [column, value] of Object.entries(fromEdit)) {
      expect([column, value]).toEqual([
        column,
        fromCommit[column as keyof typeof fromCommit],
      ]);
    }
    expect(edited).toEqual(committed);
  });

  it('refuses a duration outside 3-10 s, an empty negative prompt and a character the episode lacks', async () => {
    const { tools, commits, context } = harness();

    const tooLong = await refusal(
      tools.editShotTool.handler(
        { episodeId: EPISODE, version: 7, shotId: SHOT, durationSeconds: 12 },
        context,
      ),
    );
    expect(tooLong.code).toBe('VALIDATION_FAILED');

    const noAvoid = await refusal(
      tools.editShotTool.handler(
        {
          episodeId: EPISODE,
          version: 7,
          shotId: SHOT,
          veoPrompt: { avoid: ' ' },
        },
        context,
      ),
    );
    expect(noAvoid.details?.errors).toEqual([
      expect.objectContaining({ code: 'missing_negative_prompt' }),
    ]);

    const stranger = await refusal(
      tools.editShotTool.handler(
        { episodeId: EPISODE, version: 7, shotId: SHOT, characters: ['Zed'] },
        context,
      ),
    );
    expect(stranger.details?.errors).toEqual([
      expect.objectContaining({ code: 'unknown_character' }),
    ]);
    expect(commits).toEqual([]);
  });
});

describe('the edit tools are write tools', () => {
  it('need studio:write and are not read-only', () => {
    const { tools } = harness();

    for (const tool of Object.values(tools)) {
      expect(tool.scope).toBe('studio:write');
      expect(tool.annotations.readOnlyHint).toBe(false);
    }
  });
});
