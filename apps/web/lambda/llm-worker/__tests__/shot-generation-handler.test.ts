import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { withRun } from '@kit/ai-gateway';
import {
  type RecordingClient,
  fakeRunHandle,
  recordingClient,
  tableResponder,
} from '@kit/generation/testing';

import episodeFixture from '../../../../../packages/features/generation/__tests__/fixtures/shots-episode.json';
import shotsOutput from '../../../../../packages/features/generation/__tests__/fixtures/shots-model-output.json';
import shotsOld from '../../../../../packages/features/generation/__tests__/fixtures/shots-old-writes.json';
import {
  partOutputsFrom,
  processShotGeneration,
} from '../handlers/shot-generation';

/**
 * The shot-generation handler on the `shots` stage (FILM-1901): one Shot
 * Orchestrator run split into the reel-scout part and one part per scene,
 * the stage's check and commit, then the chained audio pass. For the
 * fixture the old handler was recorded with, the writes are the same, plus
 * who wrote the shots and the audio pass's run on its job row (FILM-1903);
 * the job the old handler queued is now a child run of the shots run,
 * carrying the same payload, and dispatched.
 *
 * KB-120: the job carries a shot-length range; the orchestrator receives it
 * and its Shot Director holds every shot to it
 * (`packages/features/episodes/__tests__/shot-duration.test.ts`).
 */

const orchestratorInputs = vi.hoisted(
  () => [] as Array<Record<string, unknown>>,
);

function orchestratorResult() {
  let shotNumber = 0;

  return {
    success: true,
    shots: shotsOutput.scenes.flatMap((scene) =>
      scene.shots.map((shot) => ({
        ...shot,
        shotNumber: ++shotNumber,
        sceneNumber: scene.sceneNumber,
      })),
    ),
    reelCandidateScenes: shotsOutput.reelScout.topReelCandidates,
    sceneAnalyses: shotsOutput.reelScout.sceneAnalyses,
    orchestratorNote: shotsOutput.reelScout.orchestratorNote,
    sceneResults: shotsOutput.scenes.map(
      ({ shots: _shots, ...scene }) => scene,
    ),
    shotQualityScore: 0.85,
    shotQualityDecision: 'pass',
    orchestratorSteps: 4,
  };
}

vi.mock('@kit/episodes/agent/shot-orchestrator', () => ({
  runShotOrchestrator: async (input: Record<string, unknown>) => {
    orchestratorInputs.push(input);
    return orchestratorResult();
  },
}));

vi.mock('../utils/context-builder', async (importOriginal) => ({
  // The real formatters, over a fixture episode; the VEO ones return the
  // fixture text the recordings were made with
  ...(await importOriginal<typeof import('../utils/context-builder')>()),
  buildEpisodeContext: async () => ({
    premise: 'Maya confronts Dev.',
    characters: episodeFixture.context.characters,
    locations: episodeFixture.context.locations,
    recurringElements: episodeFixture.context.recurringElements,
    previousEpisodes: [],
    episodeFacts: [],
    verifiedFacts: [],
    episodeNumber: 1,
    genre: episodeFixture.context.genre,
    targetAudience: episodeFixture.context.targetAudience,
    visualStyle: episodeFixture.context.visualStyle,
  }),
  formatCharactersForVeoPrompt: () => episodeFixture.context.charactersVeo,
  formatLocationsForVeoPrompt: () => episodeFixture.context.locationsVeo,
  formatRecurringElementsForPrompt: () =>
    episodeFixture.context.recurringElementsFormatted,
}));

/** The shots run the job boundary put in scope; the orchestrator writes, so the run's writer is never reached. */
function shotsRun(commitsThrough?: RecordingClient['client']) {
  const dispatched: string[] = [];
  const fake = fakeRunHandle({
    commitsThrough,
    stage: 'shots',
    accountId: episodeFixture.ids.accountId,
    projectId: episodeFixture.ids.projectId,
    targetId: episodeFixture.ids.episodeId,
    createdBy: episodeFixture.ids.userId,
    backend: {
      write: async () => {
        throw new Error('the shots run writes through its orchestrator');
      },
      dispatch: async (run) => void dispatched.push(run.id),
    },
  });

  return { ...fake, dispatched };
}

function childRuns(state: ReturnType<typeof shotsRun>['state']) {
  return state.rpcs
    .filter((rpc) => rpc.fn === 'open_generation_run')
    .map((rpc) => rpc.args as Record<string, unknown>);
}

const payload = {
  ...episodeFixture.ids,
  version: episodeFixture.episode.version,
  shotDurationMin: episodeFixture.shotDuration.min,
  shotDurationMax: episodeFixture.shotDuration.max,
};

function client() {
  return recordingClient(
    tableResponder({
      episodes: episodeFixture.episode,
      shots: episodeFixture.existingShots,
    }),
  );
}

const sorted = (writes: unknown[]) =>
  writes
    .map((w) => JSON.parse(JSON.stringify(w)) as unknown)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('processShotGeneration', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(episodeFixture.now));
  });

  afterAll(() => vi.useRealTimers());

  it('writes what the old handler wrote, and opens the audio pass as a dispatched child run with the job it queued', async () => {
    const recording = client();
    const { run, state, dispatched } = shotsRun(recording.client);

    const result = await withRun(run, () =>
      processShotGeneration(payload, recording.client),
    );

    const [child] = childRuns(state);
    const [old] = shotsOld.queued;
    const childId = [...state.rows.keys()].find((id) => id !== run.id);

    expect(result).toEqual(shotsOld.result);
    expect(childRuns(state)).toHaveLength(1);
    expect(child).toMatchObject({
      p_stage: 'audio_cues',
      p_mode: 'server',
      p_parent_run_id: run.id,
      p_account_id: old!.target.accountId,
      p_target_type: 'episode',
      p_target_id: old!.target.episodeId,
      p_input: {
        kind: 'job',
        jobType: old!.jobType,
        payload: { ...old!.payload, userId: old!.userId },
      },
    });
    expect(dispatched).toEqual([childId]);

    const origin = {
      kind: 'server',
      runId: run.id,
      at: new Date(episodeFixture.now).toISOString(),
    };
    const expected = shotsOld.writes.map((write) => {
      if (write.table === 'shots' && write.op === 'insert') {
        return {
          ...write,
          payload: (write.payload as Array<Record<string, unknown>>).map(
            (row) => ({ ...row, generation_origin: origin }),
          ),
        };
      }
      if (write.table === 'generation_jobs' && write.op === 'insert') {
        return {
          ...write,
          payload: { ...(write.payload as object), run_id: childId },
        };
      }
      return write;
    });

    expect(sorted(recording.writes())).toEqual(sorted(expected));
  });

  it('hands the orchestrator the job’s shot-length range and the prepared context (KB-120)', async () => {
    await withRun(shotsRun().run, () =>
      processShotGeneration(payload, client().client),
    );

    const input = orchestratorInputs.at(-1);

    expect(input).toMatchObject({
      shotDuration: { min: 4, max: 8 },
      // The stored title, defused for the model (KB-101)
      episodeTitle: 'Pilot — [FILTERED] instructions',
      genre: 'drama',
      charactersVeoContext: episodeFixture.context.charactersVeo,
    });
    expect(input!.scenes).toHaveLength(2);
  });

  it('opens no audio pass when the stage refuses the output', async () => {
    const recording = client();
    const { run, state, dispatched } = shotsRun(recording.client);
    const orchestrator = await import('@kit/episodes/agent/shot-orchestrator');
    const broken = orchestratorResult();
    broken.shots[0]!.veoPrompt = { ...broken.shots[0]!.veoPrompt, avoid: '' };
    const spy = vi
      .spyOn(orchestrator, 'runShotOrchestrator')
      .mockResolvedValueOnce(broken as never);

    await expect(
      withRun(run, () => processShotGeneration(payload, recording.client)),
    ).rejects.toThrow(
      /shots output for part scene:1 rejected: shots\.0\.veoPrompt\.avoid missing_negative_prompt/,
    );

    expect(childRuns(state)).toEqual([]);
    expect(dispatched).toEqual([]);
    expect(recording.writes().filter((w) => w.table === 'shots')).toEqual([]);

    spy.mockRestore();
  });
});

describe('partOutputsFrom', () => {
  it('splits one orchestrator result into the reel-scout part and a part per scene, in the screenplay’s order', () => {
    const parts = partOutputsFrom(orchestratorResult() as never, [2, 1]);

    expect([...parts.keys()]).toEqual(['reel_scout', 'scene:2', 'scene:1']);
    expect(parts.get('reel_scout')).toMatchObject({
      kind: 'reel_scout',
      topReelCandidates: [1],
      orchestratorNote: shotsOutput.reelScout.orchestratorNote,
    });
    expect(parts.get('scene:2')).toMatchObject({
      kind: 'scene',
      sceneNumber: 2,
      sceneSummary: shotsOutput.scenes[1]!.sceneSummary,
      sceneViralScore: 3.2,
    });
    expect((parts.get('scene:2') as { shots: unknown[] }).shots).toHaveLength(
      2,
    );
  });

  it('gives a scene the Shot Director lost nothing, so the stage refuses it rather than saving a shot list without it', () => {
    const result = orchestratorResult();
    result.shots = result.shots.filter((s) => s.sceneNumber !== 2);
    result.sceneResults = result.sceneResults.filter(
      (s) => s.sceneNumber !== 2,
    );

    const scene2 = partOutputsFrom(result as never, [1, 2]).get('scene:2') as {
      shots: unknown[];
      sceneViralScore?: number;
    };

    expect(scene2.shots).toEqual([]);
    expect(scene2.sceneViralScore).toBeUndefined();
  });
});
