import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setAgentStepWriter } from '@kit/agent';
import { agentStepWriterForCurrentRun, withRun } from '@kit/ai-gateway';
import { runAudioCueOrchestrator as audioCueOrchestrator } from '@kit/episodes/agent/audio-cue-orchestrator';
import { runIdeationOrchestrator as ideationOrchestrator } from '@kit/episodes/agent/ideation-orchestrator';
import { runScreenplayOrchestrator as screenplayOrchestrator } from '@kit/episodes/agent/screenplay-orchestrator';
import { runSeasonOrchestrator as seasonOrchestrator } from '@kit/episodes/agent/season-orchestrator';
import { runShotOrchestrator as shotOrchestrator } from '@kit/episodes/agent/shot-orchestrator';
import { runStoryOrchestrator as storyOrchestrator } from '@kit/episodes/agent/story-orchestrator';
import { runTranslationOrchestrator as translationOrchestrator } from '@kit/episodes/agent/translation-orchestrator';
import { fakeRunHandle } from '@kit/generation/testing';

import { ORCHESTRATOR_SCRIPTS } from '../src/llm/agents/scripts';
import { type Sandbox, guardEgress, startSandbox } from './helpers';

/**
 * FILM-1803: the studio orchestrators the llm-worker runs, each run for real
 * - the app's agent runner, its skills, their prompts and the real Gemini
 * client - against the sandbox, which plays the model: it calls each
 * orchestrator's tools in the order its prompt asks, with parameters the
 * runner validates against each tool's own schema, and ends with the final
 * answer the orchestrator reads.
 *
 * Only the database edge is stubbed: the story orchestrator reads canon and
 * writes `viral_quality` through the client it is handed, so it gets one
 * that returns an empty canon and writes nothing. Nothing leaves the machine.
 */

vi.mock('@kit/supabase/lambda-admin-client', () => ({
  createLambdaAdminClient: () => ({
    from: () => ({ insert: async () => ({ data: null, error: null }) }),
  }),
}));

/**
 * Every model call goes through a generation run (FILM-1902): the agent
 * loop through the gateway's step writer, the skills through its executor.
 * A fake open server run stands in for the worker's, so the sandbox sees the
 * same requests the worker would send.
 */
setAgentStepWriter(agentStepWriterForCurrentRun);

function underRun<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  return (...args: A) => withRun(fakeRunHandle().run, () => fn(...args));
}

const runAudioCueOrchestrator = underRun(audioCueOrchestrator);
const runIdeationOrchestrator = underRun(ideationOrchestrator);
const runScreenplayOrchestrator = underRun(screenplayOrchestrator);
const runSeasonOrchestrator = underRun(seasonOrchestrator);
const runShotOrchestrator = underRun(shotOrchestrator);
const runStoryOrchestrator = underRun(storyOrchestrator);
const runTranslationOrchestrator = underRun(translationOrchestrator);

type QueryResult = { data: unknown; error: null; count: number };

/** A Supabase client with an empty database: every query returns no rows. */
function emptyDatabase() {
  const written: string[] = [];

  const query = (table: string): unknown => {
    let single = false;
    const result = (): QueryResult => ({
      data: single ? null : [],
      error: null,
      count: 0,
    });
    const chain: Record<string, unknown> = {};
    for (const method of [
      'select',
      'eq',
      'neq',
      'in',
      'is',
      'lt',
      'lte',
      'gt',
      'gte',
      'or',
      'order',
      'limit',
      'range',
      'not',
      'contains',
      'filter',
      'match',
    ]) {
      chain[method] = () => chain;
    }
    for (const method of ['update', 'insert', 'upsert', 'delete']) {
      chain[method] = () => {
        written.push(`${method} ${table}`);
        return chain;
      };
    }
    chain.single = () => {
      single = true;
      return chain;
    };
    chain.maybeSingle = chain.single;
    chain.then = (resolve: (value: QueryResult) => unknown) =>
      Promise.resolve(resolve(result()));
    return chain;
  };

  return { client: { from: query, rpc: () => query('rpc') }, written };
}

const ACCOUNT = '18030000-0000-4000-8000-0000000000aa';
const PROJECT = '18030000-0000-4000-8000-0000000000bb';
const EPISODE = '18030000-0000-4000-8000-0000000000cc';

const CHARACTERS = [
  '- Mara Okafor: the lighthouse keeper’s granddaughter, curious and stubborn',
  '- Theo Lindqvist: a night-shift baker who knows every rumour in town',
].join('\n');
const LOCATIONS =
  '- The lighthouse on Gull Point\n- Mrs. Varga’s bakery on Canal Road';

const SCENES = [1, 2, 3].map((number) => ({
  number,
  heading: number % 2 ? 'INT. LIGHTHOUSE - NIGHT' : 'EXT. PIER NINE - DAWN',
  location: number % 2 ? 'The lighthouse on Gull Point' : 'Pier Nine',
  timeOfDay: number % 2 ? 'night' : 'dawn',
  description:
    'Mara climbs the spiral stairs with a lantern while the fog rolls in.',
  action: [
    'Mara steadies the lantern.',
    'Theo waits at the bottom of the stairs.',
  ],
  dialogue: [
    { character: 'Mara Okafor', text: 'You kept the key all this time?' },
    { character: 'Theo Lindqvist', text: 'Somebody has to keep the light on.' },
  ],
  estimatedDuration: 20,
}));

/**
 * Tool failures the app has today, whatever the model does. Each names its
 * known bug. Every failure seen must be listed, and every listed one must
 * still happen: when a KB is fixed, this fails until the entry goes.
 */
const KNOWN_TOOL_FAILURES: Array<{
  kb: string;
  orchestrator: string;
  tool: string;
  error: RegExp;
}> = [];

const knownFailure = (orchestrator: string, tool: string) =>
  KNOWN_TOOL_FAILURES.find(
    (k) => k.orchestrator === orchestrator && k.tool === tool,
  );

let sandbox: Sandbox;
let refused: string[];

beforeAll(async () => {
  sandbox = await startSandbox(2026);
  refused = guardEgress();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await sandbox.close();
});

/** The agent turns this run produced, from the ledger. */
function agentTurns(name: string) {
  return sandbox.state.ledger
    .list({ vendor: 'gemini' })
    .filter((e) => e.identified?.kind === 'agent' && e.identified.key === name);
}

describe('the studio orchestrators, against the sandbox', () => {
  it('has a script for every orchestrator the llm-worker runs', () => {
    expect(ORCHESTRATOR_SCRIPTS.map((s) => s.name).sort()).toEqual([
      'audio-cue-orchestrator',
      'ideation-orchestrator',
      'screenplay-orchestrator',
      'season-orchestrator',
      'shot-orchestrator',
      'story-orchestrator',
      'translation-orchestrator',
    ]);
  });

  it('ideation: generates and evaluates the ideas asked for', async () => {
    const result = await runIdeationOrchestrator({
      episodeId: EPISODE,
      accountId: ACCOUNT,
      premise: 'A lighthouse that starts sending letters to the town',
      numberOfIdeas: 3,
      genre: 'cozy mystery',
      targetAudience: 'families with kids aged 8 to 12',
      charactersContext: CHARACTERS,
      locationsContext: LOCATIONS,
    });

    expect(result.success, result.error).toBe(true);
    expect(result.ideas).toHaveLength(3);
    for (const idea of result.ideas)
      expect(idea.title.length).toBeGreaterThan(0);
    expect(agentTurns('ideation-orchestrator')).toHaveLength(3);
  });

  it.each([undefined, 'documentary', 'movie'] as const)(
    'story (%s): writes, scores, checks continuity and persists the verdict',
    async (contentType) => {
      const db = emptyDatabase();
      const result = await runStoryOrchestrator(
        {
          episodeId: EPISODE,
          projectId: PROJECT,
          accountId: ACCOUNT,
          episodeTitle: 'The Letter Under the Floorboards',
          episodeLogline:
            'Mara finds a sealed letter in the lighthouse and Theo helps her find its sender.',
          genre: 'cozy mystery',
          targetAudience: 'families with kids aged 8 to 12',
          targetDurationSeconds: 180,
          episodeNumber: 2,
          contentType,
          actNumber: contentType === 'movie' ? 1 : undefined,
          verifiedFacts:
            contentType === 'documentary'
              ? 'FACT [f1]: Lighthouse keepers logged the weather every four hours.'
              : undefined,
          charactersContext: CHARACTERS,
          locationsContext: LOCATIONS,
        },
        db.client,
      );

      expect(result.success, result.error).toBe(true);
      expect(result.storyText?.length).toBeGreaterThan(0);
      expect(typeof result.viralQuality?.overallScore).toBe('number');
      expect(db.written).toContain('update episodes');

      const tools = agentTurns('story-orchestrator')
        .map((e) => e.responseSummary ?? '')
        .map((reply) => /"tool": "(\w+)"/.exec(reply)?.[1])
        .filter(Boolean);
      expect(tools).toContain('generateStory');
      if (contentType === 'documentary')
        expect(tools).toContain('factCheckContent');
      if (contentType === 'movie') expect(tools).toContain('extractActContext');
    },
  );

  it('screenplay: converts the story into the expected number of scenes', async () => {
    const result = await runScreenplayOrchestrator({
      episodeId: EPISODE,
      accountId: ACCOUNT,
      episodeTitle: 'The Letter Under the Floorboards',
      episodeNumber: 2,
      genre: 'cozy mystery',
      targetAudience: 'families with kids aged 8 to 12',
      targetDurationSeconds: 180,
      storyText:
        'Mara finds a sealed letter in the lighthouse. Theo helps her trace its sender to the old paper mill.',
      charactersContext: CHARACTERS,
      characterNames: 'Mara Okafor, Theo Lindqvist',
      locationNames: 'The lighthouse on Gull Point, Pier Nine',
      sceneCountMin: 3,
      sceneCountMax: 5,
      dialogueLinesPerSceneMin: 2,
      dialogueLinesPerSceneMax: 6,
      actBreakdown: {
        act1: 'The letter is found.',
        act2: 'The search.',
        act3: 'The sender is found.',
      },
      tone: 'warm',
      themes: ['friendship', 'curiosity'],
      keyEvents: ['Mara opens the letter'],
    });

    expect(result.success, result.error).toBe(true);
    expect(result.scenes.length).toBeGreaterThan(0);
  });

  it('season: outlines and evaluates the season', async () => {
    const result = await runSeasonOrchestrator({
      projectId: PROJECT,
      accountId: ACCOUNT,
      seasonPremise:
        'A summer of letters from a lighthouse nobody has lit in years',
      episodeCount: 4,
      startingNumber: 1,
      genre: 'cozy mystery',
      style: 'cinematic',
      existingCharacters: CHARACTERS,
      existingLocations: LOCATIONS,
      recurringElements: '',
    });

    expect(result.success, result.error).toBe(true);
    expect(result.episodes.length).toBeGreaterThan(0);
    // KB-116: the arc score comes from an evaluation, within its 0-1 range.
    expect(result.arcScore).toBeGreaterThanOrEqual(0);
    expect(result.arcScore).toBeLessThanOrEqual(1);
  });

  it('season: a run whose outliner step fails is a failure, not a season', async () => {
    const recorded = sandbox.state.agentToolFailures.length;
    await fetch(`${sandbox.urls.control}/__sandbox/fail`, {
      method: 'POST',
      body: JSON.stringify({
        vendor: 'gemini',
        prompt: 'season-outline',
        status: 400,
        count: 1,
      }),
    });

    try {
      const result = await runSeasonOrchestrator({
        projectId: PROJECT,
        accountId: ACCOUNT,
        seasonPremise:
          'A summer of letters from a lighthouse nobody has lit in years',
        episodeCount: 4,
        startingNumber: 1,
        genre: 'cozy mystery',
        style: 'cinematic',
        existingCharacters: CHARACTERS,
        existingLocations: LOCATIONS,
        recurringElements: '',
      });

      expect(result.success).toBe(false);
      expect(result.episodes).toEqual([]);
      expect(result.error).toMatch(/Season Outliner produced no episodes/);
      // The sandbox saw the tool fail, as the runner reported it back.
      expect(sandbox.state.agentToolFailures.slice(recorded)).toContainEqual(
        expect.objectContaining({
          orchestrator: 'season-orchestrator',
          tool: 'generateSeasonOutline',
        }),
      );
    } finally {
      // The failures this test caused on purpose are not the app's.
      sandbox.state.agentToolFailures.splice(recorded);
    }
  });

  it('shot: scouts reels, generates shots and scores them', async () => {
    const result = await runShotOrchestrator({
      episodeId: EPISODE,
      accountId: ACCOUNT,
      episodeTitle: 'The Letter Under the Floorboards',
      genre: 'cozy mystery',
      targetAudience: 'families with kids aged 8 to 12',
      visualStyle: 'warm hand-painted animation',
      scenes: SCENES,
      charactersVeoContext: CHARACTERS,
      locationsVeoContext: LOCATIONS,
    });

    expect(result.success, result.error).toBe(true);
    expect(result.shots.length).toBeGreaterThan(0);
  });

  it('audio cues: generates and evaluates cues for the timeline', async () => {
    const result = await runAudioCueOrchestrator({
      episodeId: EPISODE,
      accountId: ACCOUNT,
      shotsJson: JSON.stringify(
        SCENES.map((scene, i) => ({
          sequence: i + 1,
          sceneNumber: scene.number,
          duration: 6,
          description: scene.description,
        })),
      ),
      totalDurationSeconds: 18,
    });

    expect(result.success, result.error).toBe(true);
    expect(result.cues.length).toBeGreaterThan(0);
  });

  it('translation: translates every line and verifies it', async () => {
    const result = await runTranslationOrchestrator({
      episodeId: EPISODE,
      accountId: ACCOUNT,
      targetLanguage: 'es',
      targetLanguageName: 'Spanish',
      preserveTiming: false,
      lineCount: 3,
      dialogueLines: [
        '1. [curious] You kept the key all this time?',
        '2. [warm] Somebody has to keep the light on.',
        '3. [tense] Did you hear that? Under the floor.',
      ].join('\n'),
    });

    expect(result.success, result.error).toBe(true);
    expect(result.translations).toHaveLength(3);
    expect(result.verificationScore).toBeGreaterThanOrEqual(0);
    expect(result.verificationScore).toBeLessThanOrEqual(1);
  });

  it('let nothing leave the machine', () => {
    expect(refused).toEqual([]);
  });

  it('saw exactly the tool failures on record, and no others', () => {
    const seen = sandbox.state.agentToolFailures;

    const unknown = seen.filter((f) => {
      const known = knownFailure(f.orchestrator, f.tool);
      return !known || !known.error.test(f.error);
    });
    expect(unknown, 'a tool failed that no KB records').toEqual([]);

    const stale = KNOWN_TOOL_FAILURES.filter(
      (k) =>
        !seen.some(
          (f) => f.orchestrator === k.orchestrator && f.tool === k.tool,
        ),
    ).map((k) => `${k.kb}: ${k.orchestrator} → ${k.tool}`);
    expect(
      stale,
      'listed as a known failure but it did not fail - if the KB is fixed, remove the entry and mark it fixed',
    ).toEqual([]);
  });
});
