import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type EpisodeContextLoader,
  type EpisodeContextSnapshot,
  type PartSpec,
  type RunBackend,
  type RunCtx,
  type RunHandle,
  type ScreenplayScene,
  type StageKey,
  type TargetType,
  executeServerRun,
  finalizeRun,
  openRun,
  registeredStageKeys,
  stageRegistry,
} from '../src';
import {
  type RecordedCall,
  type RecordedWrite,
  type Responder,
  TEST_IDS,
  recordingClient,
  runStoreResponder,
  runStoreState,
  tableResponder,
  writesOf,
} from '../src/testing';
import {
  audioFixture,
  audioPartOutputs,
  episodeFixture,
  factFixture,
  fixtureEpisodeContext,
  pagedResponder,
  shotsPartOutputs,
  summaryFixture,
} from './helpers/part-d';
import {
  IDS,
  SNAPSHOT,
  TABLES,
  responder as worldRows,
} from './stages/helpers';

/**
 * FILM-1902 criteria 9 and 10. Every registered stage runs in both modes
 * against fixtures: in server mode through a stubbed writer, which is the
 * only model door and is reached exactly once per part; in external mode
 * with a submitted fixture, where the writer is never reached and no usage
 * row can exist because no model was called. The matrix is generic over
 * `stageRegistry`: a stage registered without a fixture here fails the
 * suite, naming itself, so a stage that only works in one mode cannot ship.
 */

const NOW = new Date('2026-10-03T12:00:00.000Z');
const LINE_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const LINE_2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const LINE_3 = 'aaaaaaaa-0000-4000-8000-000000000003';

interface StageFixture {
  /** The StageDefinition target */
  target: unknown;
  /** The run's lock */
  lock: { type: TargetType; id: string; projectId: string | null };
  /** The model's (or agent's) output for a part */
  output: (part: PartSpec) => unknown;
  /** The rows the stage reads */
  respond: Responder;
  /** The episode context the stage's prepare() loads; WORLD unless given */
  context?: EpisodeContextLoader;
}

const WORLD: EpisodeContextSnapshot = {
  episodeNumber: 5,
  seasonNumber: 1,
  characters:
    'CHARACTER 1 — LOCKED IDENTITY:\n  Name: Maya\n  Role: protagonist\n\nCHARACTER 2 — LOCKED IDENTITY:\n  Name: Houston\n  Role: support',
  locations:
    '**Locations**:\n- **Observation Deck** (interior): Glass and starlight',
  previousEpisodes: '',
  counts: { characters: 2, locations: 1 },
  characterList: [
    { id: 'c1', name: 'Maya' },
    { id: 'c2', name: 'Houston' },
  ],
  locationList: [{ id: 'l1', name: 'Observation Deck' }],
  recurringElements: '',
};

function scene(
  number: number,
  overrides: Partial<ScreenplayScene> = {},
): ScreenplayScene {
  return {
    number,
    heading: `INT. OBSERVATION DECK - DAY ${number}`,
    location: 'Observation Deck',
    timeOfDay: 'day',
    description: 'Maya floats at the window.',
    dialogue: [
      { character: 'Maya', text: '[urgently] Houston, please respond.' },
      { character: 'Houston', text: '[calmly] We read you.' },
    ],
    estimatedDuration: 30,
    ...overrides,
  };
}

const EPISODE = {
  id: TEST_IDS.episode,
  number: 5,
  title: 'The Last Signal',
  version: 3,
  status: 'story',
  deleted_at: null,
  story_data: {
    fullStory: 'Maya hears her own voice on the comm and must decide.',
    title: 'The Last Signal',
    tone: 'tense',
    actBreakdown: { act1: 'Setup', act2: 'Confrontation', act3: 'Resolution' },
    themes: ['identity'],
    characters: [{ name: 'Maya', role: 'protagonist', arc: 'Learns to trust' }],
    keyEvents: ['The comm crackles'],
    estimatedSceneCount: 3,
  },
  screenplay_data: {
    scenes: [scene(1)],
    metadata: {
      characters: ['Maya', 'Houston'],
      locations: ['Observation Deck'],
    },
  },
  target_duration_seconds: 120,
  metadata: { target_audience: 'kids 6-12', refinement_history: [] },
  generation_origin: {},
  project: {
    id: TEST_IDS.project,
    account_id: TEST_IDS.account,
    metadata: { genre: 'sci-fi', targetAudience: 'kids 6-12' },
  },
};

const ENGLISH_LINES = [
  {
    id: LINE_1,
    scene_number: 1,
    sequence_number: 1,
    text: 'Houston, please respond.',
  },
  { id: LINE_2, scene_number: 1, sequence_number: 2, text: 'We read you.' },
  {
    id: LINE_3,
    scene_number: 2,
    sequence_number: 3,
    text: 'Three hours later.',
  },
].map((line) => ({
  ...line,
  episode_id: TEST_IDS.episode,
  character_asset_id: null,
  shot_id: null,
  timeline_start_seconds: null,
  estimated_duration_seconds: 2.5,
}));

/** The part C test's client: an episode, and English dialogue lines by scene. */
const episodeRows: Responder = (() => {
  const fixtures = tableResponder({
    episodes: EPISODE,
    generation_jobs: null,
    dialogue_lines: null,
  });

  return (call: RecordedCall) => {
    if (call.table === 'dialogue_lines' && writesOf([call]).length === 0) {
      const language = call.chain.find(
        (step) => step.method === 'eq' && step.args[0] === 'language',
      )?.args[1];

      return { data: language === 'en' ? ENGLISH_LINES : [] };
    }

    return fixtures(call);
  };
})();

const episodeLock = {
  type: 'episode' as const,
  id: TEST_IDS.episode,
  projectId: TEST_IDS.project,
};

const TRANSLATIONS: Record<
  string,
  Array<{ sourceDialogueId: string; text: string }>
> = {
  'scene-1': [
    { sourceDialogueId: LINE_1, text: 'Houston, responde.' },
    { sourceDialogueId: LINE_2, text: 'Te escuchamos.' },
  ],
  'scene-2': [{ sourceDialogueId: LINE_3, text: 'Tres horas después.' }],
};

const STORY_TEXT =
  'Maya floats in the silence of the observation deck. '.repeat(40);

/** Part D's fixtures (#561) share one episode and project; their ids differ from TEST_IDS. */
const partDEpisodeLock = {
  type: 'episode' as const,
  id: episodeFixture.ids.episodeId,
  projectId: episodeFixture.ids.projectId,
};

const FIXTURES: Partial<Record<StageKey, StageFixture>> = {
  shots: {
    target: {
      ...episodeFixture.ids,
      shotDuration: episodeFixture.shotDuration,
    },
    lock: partDEpisodeLock,
    output: (part) => shotsPartOutputs().get(part.key),
    respond: tableResponder({
      episodes: episodeFixture.episode,
      shots: episodeFixture.existingShots,
    }),
    context: fixtureEpisodeContext,
  },
  audio_cues: {
    target: audioFixture.ids,
    lock: partDEpisodeLock,
    output: (part) => audioPartOutputs().get(part.key),
    respond: pagedResponder({ shots: audioFixture.shots }),
  },
  fact_extraction: {
    target: factFixture.payload,
    lock: {
      type: 'project',
      id: episodeFixture.ids.projectId,
      projectId: episodeFixture.ids.projectId,
    },
    output: () => factFixture.modelOutput,
    respond: tableResponder({}),
  },
  episode_summary: {
    target: summaryFixture.input,
    lock: partDEpisodeLock,
    output: () => summaryFixture.modelOutput,
    respond: tableResponder({
      narrative_threads: summaryFixture.threads,
      assets: summaryFixture.characters,
    }),
  },
  story: {
    target: {
      episodeId: TEST_IDS.episode,
      projectId: TEST_IDS.project,
      title: 'The Last Signal',
      logline: 'A lonely astronaut hears a signal that carries her own voice.',
      targetDuration: 300,
      contentStyle: 'dialogue-heavy',
      themes: ['isolation'],
      hook: 'The signal is her own voice.',
    },
    lock: episodeLock,
    output: () => ({
      story: {
        title: 'The Last Signal',
        fullText: STORY_TEXT,
        actBreakdown: { act1: 'Hears.', act2: 'Decodes.', act3: 'Sends.' },
        characters: [
          {
            name: 'Maya Chen',
            role: 'protagonist',
            arc: 'Routine to purpose.',
          },
        ],
        themes: ['isolation'],
        tone: 'contemplative',
        estimatedSceneCount: 6,
        episodeSummary: 'Maya hears and sends the signal.',
        sentimentScore: 0.6,
        keyEvents: ['Maya hears the signal'],
      },
    }),
    respond: worldRows(),
    context: async () => SNAPSHOT,
  },
  ideation: {
    target: {
      episodeId: TEST_IDS.episode,
      premise: 'A signal from nowhere.',
      numberOfIdeas: 2,
    },
    lock: episodeLock,
    output: () => ({
      ideas: [
        {
          title: 'The Last Signal',
          logline: 'An astronaut hears her own voice from the future.',
          hook: 'The voice is hers.',
          conflict: 'Obey or act.',
          themes: ['isolation'],
          visualPotential: 'One lit console.',
          qualityScore: 0.8,
        },
        {
          title: 'Static',
          logline: 'The signal leaks.',
          hook: 'Someone knew.',
          themes: ['trust'],
          visualPotential: 'Crowds and screens.',
        },
      ],
    }),
    respond: worldRows(),
    context: async () => SNAPSHOT,
  },
  season_outline: {
    target: {
      projectId: TEST_IDS.project,
      seasonId: IDS.seasonId,
      seasonPremise: 'Humanity builds its first deep-space relay.',
      episodeCount: 2,
      startingNumber: 3,
      genre: 'sci-fi',
      style: 'cinematic',
    },
    lock: { type: 'season', id: IDS.seasonId, projectId: TEST_IDS.project },
    output: () => ({
      episodes: [
        {
          number: 3,
          title: 'The First Light',
          premise: 'A mysterious signal from deep space awakens humanity.',
          mainPlot:
            'Dr. Sarah Chen discovers a pattern in cosmic background radiation that defies natural explanation.',
          characterFocus: ['Maya Chen'],
          arcPosition: 'setup',
        },
        {
          number: 4,
          title: 'Static',
          premise: 'As the world learns about the signal, factions emerge.',
          mainPlot:
            'The discovery leaks to the press, sparking global chaos while Marcus uncovers evidence.',
          arcPosition: 'rising',
        },
      ],
    }),
    respond: worldRows(TABLES),
  },
  season_analysis: {
    target: {
      projectId: TEST_IDS.project,
      roadmap:
        '* **Creature:** The Dragon\n* **The Mystery:** Something is missing',
      externalFacts: [
        {
          id: 'f1',
          claim: 'Dragons hoard gold.',
          source_citation: 'Lore, p.3',
        },
      ],
    },
    lock: {
      type: 'project',
      id: TEST_IDS.project,
      projectId: TEST_IDS.project,
    },
    output: () => ({
      premise: 'A detective and a dragon solve small mysteries.',
      tone: 'comedic',
      target_audience: 'kids 4-8',
      characters: [
        {
          name: 'Dante',
          role: 'protagonist',
          description: 'A patient detective.',
        },
      ],
      locations: [
        { name: 'The Market', description: 'A busy square.', setting: 'town' },
      ],
      episodes: [
        {
          number: 1,
          title: 'The Missing Weight',
          synopsis: 'Something goes missing.',
          beats: [{ label: 'The Mystery', content: 'Something is missing' }],
          moral: 'Be kind.',
          signature_line: null,
          character_names: ['Dante'],
          location_names: ['The Market'],
          tags: ['comedy'],
          fact_ids: ['f1'],
        },
      ],
    }),
    respond: worldRows(),
  },
  story_refinement: {
    target: { episodeId: TEST_IDS.episode, feedback: 'darker' },
    lock: episodeLock,
    output: () => ({ story: { fullText: 'This time, nobody answers.' } }),
    respond: episodeRows,
  },
  asset_description: {
    target: {
      projectId: TEST_IDS.project,
      asset: { name: 'Maya Chen', type: 'character', role: 'lead' },
      storyContext: 'Maya floats in the silence.',
    },
    lock: { type: 'asset', id: TEST_IDS.run, projectId: TEST_IDS.project },
    output: () => ({ description: 'A tall engineer.' }),
    respond: tableResponder({
      assets: { id: 'asset-1', name: 'Maya Chen', type: 'character' },
    }),
  },
  screenplay: {
    target: { episodeId: TEST_IDS.episode },
    lock: episodeLock,
    // part i holds scene i+1
    output: (part) => ({ scenes: [scene(part.index + 1)] }),
    respond: episodeRows,
  },
  screenplay_refinement: {
    target: { episodeId: TEST_IDS.episode, feedback: 'Make Maya calmer' },
    lock: episodeLock,
    output: () => ({
      screenplay: {
        scenes: [scene(1, { description: 'Maya floats, calmer now.' })],
        metadata: {
          totalScenes: 1,
          estimatedDuration: 30,
          locations: ['Observation Deck'],
          characters: ['Maya', 'Houston'],
        },
      },
    }),
    respond: episodeRows,
  },
  dialogue_translation: {
    target: {
      episodeId: TEST_IDS.episode,
      targetLanguage: 'es',
      preserveTiming: true,
    },
    lock: episodeLock,
    output: (part) => ({ translations: TRANSLATIONS[part.key] ?? [] }),
    respond: episodeRows,
  },
  publish_metadata: {
    target: {
      items: [
        {
          id: 'full-video-hi',
          contentType: 'full-video',
          title: 'The Last Signal',
          description: 'An astronaut hears her own voice.',
          targetLanguage: 'hi',
        },
      ],
    },
    lock: { type: 'publish', id: TEST_IDS.run, projectId: TEST_IDS.project },
    output: () => ({
      translations: [
        {
          id: 'full-video-hi',
          targetLanguage: 'hi',
          title: 'आखिरी सिग्नल',
          description: 'विवरण',
        },
      ],
    }),
    respond: episodeRows,
  },
};

/** The tables whose rows carry generation_origin and whose stages stamp it today. */
const STAMPED_TABLES = new Set(['episodes', 'assets', 'shots', 'audio_cues']);

/**
 * The tables FILM-1903's migration gave a generation_origin column. A write
 * stamping any other table fails in Postgres (verified_facts has none).
 */
const ORIGIN_COLUMN_TABLES = new Set([...STAMPED_TABLES, 'dialogue_lines']);

/** The child runs a stage's commit opens (FILM-1903): shots chains its audio pass. */
const FOLLOW_ONS: Partial<Record<StageKey, StageKey[]>> = {
  shots: ['audio_cues'],
};

/** Each follow-on is a child of the run, in its mode; a server child is dispatched, an external one is not. */
function expectChildren(
  key: StageKey,
  children: RunHandle[],
  parentId: string,
  mode: 'server' | 'external',
) {
  expect(
    children.map((child) => [child.stage, child.mode, child.parentRunId]),
    key,
  ).toEqual((FOLLOW_ONS[key] ?? []).map((stage) => [stage, mode, parentId]));
}

/** Stages whose commit hands its result to the user for review and writes nothing. */
const REVIEW_STAGES = new Set<StageKey>(['episode_summary']);

/** The stage's own outcome: a review stage's commit is a `skipped` that says why. */
function expectCommitted(key: StageKey, commit: { status: string }) {
  expect(commit.status, key).toBe(
    REVIEW_STAGES.has(key) ? 'skipped' : 'committed',
  );
}

function payloadsOf(writes: RecordedWrite[]) {
  return writes.map((w) => JSON.stringify(w.payload ?? null));
}

/** Every write that stamps generation_origin goes to a table that has the column. */
function expectOriginOnlyWhereColumnsExist(
  key: StageKey,
  writes: RecordedWrite[],
) {
  const misplaced = writes
    .filter((w) =>
      JSON.stringify(w.payload ?? null).includes('generation_origin'),
    )
    .map((w) => w.table)
    .filter((table) => !ORIGIN_COLUMN_TABLES.has(table));

  expect(
    misplaced,
    `${key} stamps a table with no generation_origin column`,
  ).toEqual([]);
}

function harness(
  fixture: StageFixture,
  mode: 'server' | 'external',
  backend: RunBackend,
) {
  const state = runStoreState();
  const recording = recordingClient(runStoreResponder(state, fixture.respond));
  // The commit's plan is replayed through the same recording (one call per
  // write), so the matrix sees the rows apply_generation_commit would write
  state.client = recording.client;
  const ctx: RunCtx = {
    client: recording.client,
    accountId: TEST_IDS.account,
    userId: TEST_IDS.user,
    backend,
    runMode: mode === 'external' ? () => 'external' : undefined,
    episodeContext: fixture.context ?? (async () => WORLD),
  };

  return { state, recording, ctx };
}

function runTarget(fixture: StageFixture) {
  return {
    ...fixture.lock,
    accountId: TEST_IDS.account,
    input: { kind: 'stage' as const, target: fixture.target },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the registry and the writer agree (FILM-1902 criterion 9)', () => {
  it('every registered stage has a fixture, and nothing else does', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(registeredStageKeys().sort());
  });

  it('every registered stage reaches run.write() once per part in server mode, and no other code path does', async () => {
    const reached = new Set<string>();

    for (const key of registeredStageKeys()) {
      const fixture = FIXTURES[key]!;
      const write = vi.fn(async (_run, brief) => {
        reached.add(brief.stage);
        return { output: fixture.output(brief.part) };
      });
      const { ctx } = harness(fixture, 'server', { write, dispatch: vi.fn() });
      const run = await openRun(
        key,
        runTarget(fixture),
        { kind: 'web', name: 'matrix' },
        ctx,
      );

      await executeServerRun(run, ctx);

      const parts = await stageRegistry.get(key)!.parts(ctx, fixture.target);
      expect(parts.length, key).toBeGreaterThan(0);
      expect(write, key).toHaveBeenCalledTimes(parts.length);
    }

    expect([...reached].sort()).toEqual(registeredStageKeys().sort());
  });
});

describe('every registered stage runs in both modes (FILM-1902 criterion 10)', () => {
  for (const key of registeredStageKeys()) {
    const fixture = FIXTURES[key];

    it(`${key} has a fixture`, () => {
      expect(fixture, `add a fixture for ${key} to FIXTURES`).toBeDefined();
    });

    if (!fixture) continue;

    it(`${key} in server mode: the stubbed writer is the model, the commit stamps a server origin`, async () => {
      const write = vi.fn(async (_run, brief) => ({
        output: fixture.output(brief.part),
        usage: { provider: 'stub', model: 'stub-1', tokens: 1 },
      }));
      const { ctx, state, recording } = harness(fixture, 'server', {
        write,
        dispatch: vi.fn(),
      });
      const run = await openRun(
        key,
        runTarget(fixture),
        { kind: 'web', name: 'matrix' },
        ctx,
      );

      const result = await executeServerRun(run, ctx);

      expectCommitted(key, result.commit);
      expect(run.mode).toBe('server');
      expect(state.rows.get(run.id)?.status).toBe('committed');
      expect(write).toHaveBeenCalled();
      expectOriginOnlyWhereColumnsExist(key, recording.writes());
      expectChildren(key, result.children, run.id, 'server');

      const stampable = recording
        .writes()
        .filter((w) => STAMPED_TABLES.has(w.table));
      if (stampable.length > 0) {
        const stamped = payloadsOf(stampable).some(
          (p) => p.includes('"kind":"server"') && p.includes(run.id),
        );
        expect(stamped, `${key} stamps generation_origin`).toBe(true);
      }
    });

    it(`${key} in external mode: the submitted fixture is committed, the writer is never reached, no usage row can exist`, async () => {
      const write = vi.fn();
      const dispatch = vi.fn();
      const { ctx, state, recording } = harness(fixture, 'external', {
        write,
        dispatch,
      });
      const run = await openRun(
        key,
        runTarget(fixture),
        { kind: 'mcp', name: 'matrix', clientName: 'test-client' },
        ctx,
      );

      expect(run.mode).toBe('external');

      const parts = await stageRegistry.get(key)!.parts(ctx, fixture.target);
      const result = await finalizeRun(
        run,
        ctx,
        parts.map((part) => ({ key: part.key, output: fixture.output(part) })),
      );

      expectCommitted(key, result.commit);
      expect(write).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      expectOriginOnlyWhereColumnsExist(key, recording.writes());
      expectChildren(key, result.children, run.id, 'external');
      // Zero llm_usage_analytics rows: no insert into the table was issued
      expect(
        recording.writes().filter((w) => w.table === 'llm_usage_analytics'),
      ).toEqual([]);
      expect(state.rows.get(run.id)?.status).toBe('committed');

      const stampable = recording
        .writes()
        .filter((w) => STAMPED_TABLES.has(w.table));
      if (stampable.length > 0) {
        const stamped = payloadsOf(stampable).some(
          (p) => p.includes('"kind":"external"') && p.includes('test-client'),
        );
        expect(
          stamped,
          `${key} stamps an external origin with the client`,
        ).toBe(true);
      }
    });
  }
});

/**
 * FILM-1901 criterion 4, FILM-1903: a stage's side effects are one plan the
 * run applies in one transaction. The plan is replayed through a second
 * recording here, so the stage's own client shows what was written outside
 * it: only runStage's generation_jobs bookkeeping before the commit.
 */
describe('every registered stage commits through one plan (FILM-1903)', () => {
  for (const key of registeredStageKeys()) {
    const fixture = FIXTURES[key];
    if (!fixture) continue;

    for (const mode of ['server', 'external'] as const) {
      it(`${key} in ${mode} mode writes only through apply_generation_commit, once, closing the run`, async () => {
        const write = vi.fn(async (_run, brief) => ({
          output: fixture.output(brief.part),
        }));
        const { ctx, state, recording } = harness(fixture, mode, {
          write,
          dispatch: vi.fn(),
        });
        const replay = recordingClient(fixture.respond);
        state.client = replay.client;

        const run = await openRun(
          key,
          runTarget(fixture),
          { kind: mode === 'server' ? 'web' : 'mcp', name: 'matrix' },
          ctx,
        );

        if (mode === 'server') {
          await executeServerRun(run, ctx);
        } else {
          const parts = await stageRegistry
            .get(key)!
            .parts(ctx, fixture.target);
          await finalizeRun(
            run,
            ctx,
            parts.map((part) => ({
              key: part.key,
              output: fixture.output(part),
            })),
          );
        }

        const outside = recording
          .writes()
          .filter(
            (w) =>
              !(
                w.table === 'generation_jobs' &&
                (w.payload as { status?: string }).status === 'processing'
              ),
          );
        expect(outside, `${key} writes outside its plan`).toEqual([]);
        expect(state.commits.length, key).toBeLessThanOrEqual(1);

        if (replay.writes().length > 0) {
          expect(state.commits, key).toEqual([
            expect.objectContaining({ runId: run.id, finalize: true }),
          ]);
        }

        // The snapshot is the database's, inside the same call
        expect(
          state.rpcs.filter((rpc) => rpc.fn === 'record_content_revision'),
        ).toEqual([]);
        expect(state.rows.get(run.id)?.status).toBe('committed');
      });
    }
  }
});
