import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { recordingClient, tableResponder } from '@kit/generation/testing';

import audioFixture from '../../../../../packages/features/generation/__tests__/fixtures/audio-cues-fixture.json';
import factFixture from '../../../../../packages/features/generation/__tests__/fixtures/fact-extraction-fixture.json';
import episodeFixture from '../../../../../packages/features/generation/__tests__/fixtures/shots-episode.json';
import shotsOutput from '../../../../../packages/features/generation/__tests__/fixtures/shots-model-output.json';

/**
 * FILM-1901 parity capture (part D). Runs a fixture model output through the
 * OLD handlers for shots, audio cues and fact extraction, records every
 * Supabase write they make, and saves the recording beside the fixtures.
 * The stage parity tests in `@kit/generation` replay the same fixture
 * through the new commit and compare against this recording.
 *
 * Deleted in the same PR, once the old handler bodies are gone.
 */

const FIXTURES = path.resolve(
  __dirname,
  '../../../../../packages/features/generation/__tests__/fixtures',
);

const queued = vi.hoisted(() => [] as unknown[]);

vi.mock('@kit/episodes/agent/shot-orchestrator', () => ({
  runShotOrchestrator: async () => {
    // The orchestrator flattens the per-scene outputs and renumbers across
    // scenes (shot-director-skill.ts "Reassign global sequence numbers").
    let shotNumber = 0;
    const shots = shotsOutput.scenes.flatMap((scene) =>
      scene.shots.map((shot) => ({
        ...shot,
        shotNumber: ++shotNumber,
        sceneNumber: scene.sceneNumber,
      })),
    );

    return {
      success: true,
      shots,
      reelCandidateScenes: shotsOutput.reelScout.topReelCandidates,
      sceneAnalyses: shotsOutput.reelScout.sceneAnalyses,
      shotQualityScore: 0.85,
      shotQualityDecision: 'pass',
      orchestratorSteps: 4,
    };
  },
}));

vi.mock('../utils/context-builder', () => ({
  buildEpisodeContext: async () => ({
    characters: episodeFixture.context.characters,
    locations: episodeFixture.context.locations,
    recurringElements: episodeFixture.context.recurringElements,
    genre: episodeFixture.context.genre,
    targetAudience: episodeFixture.context.targetAudience,
    visualStyle: episodeFixture.context.visualStyle,
  }),
  formatCharactersForVeoPrompt: () => episodeFixture.context.charactersVeo,
  formatLocationsForVeoPrompt: () => episodeFixture.context.locationsVeo,
  formatRecurringElementsForPrompt: () =>
    episodeFixture.context.recurringElementsFormatted,
}));

vi.mock('@kit/episodes/agent/audio-cue-orchestrator', () => ({
  runAudioCueOrchestrator: async () => ({
    success: true,
    cues: audioFixture.cues,
    ...audioFixture.orchestrator,
    verdict: 'pass',
  }),
}));

vi.mock('@kit/prompt-engine/server', () => ({
  queueLlmJob: async (job: unknown) => {
    queued.push(job);
    return { messageId: 'm1' };
  },
  chainedLlmJobTarget: (target: unknown) => target,
  executeLLM: async () => ({
    data: factFixture.modelOutput,
    metadata: {
      latency: 10,
      tokens: 100,
      cost: 0,
      provider: 'gemini',
      model: 'test',
    },
  }),
}));

function save(name: string, value: unknown) {
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(
    path.join(FIXTURES, name),
    JSON.stringify(value, null, 2) + '\n',
  );
}

describe('old handler writes, recorded for the FILM-1901 parity tests', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(episodeFixture.now));
  });

  afterAll(() => vi.useRealTimers());

  it('shots: processShotGeneration', async () => {
    const { processShotGeneration } = await import(
      '../handlers/shot-generation'
    );

    const recording = recordingClient(
      tableResponder({
        episodes: episodeFixture.episode,
        shots: episodeFixture.existingShots,
      }),
    );

    const result = await processShotGeneration(
      {
        ...episodeFixture.ids,
        version: episodeFixture.episode.version,
        shotDurationMin: episodeFixture.shotDuration.min,
        shotDurationMax: episodeFixture.shotDuration.max,
      },
      recording.client,
    );

    expect(result.success).toBe(true);
    expect(result.data.totalShots).toBe(4);

    save('shots-old-writes.json', {
      writes: recording.writes(),
      queued,
      result,
    });
  });

  it('audio cues: processAudioCueGeneration', async () => {
    const { processAudioCueGeneration } = await import(
      '../handlers/audio-cue-generation'
    );

    const recording = recordingClient(
      tableResponder({ shots: audioFixture.shots }),
    );

    const result = await processAudioCueGeneration(
      audioFixture.ids,
      recording.client,
    );

    // The cue on shot 9 is dropped with a warning
    expect(result).toEqual({ success: true, cuesCreated: 4 });

    save('audio-cues-old-writes.json', {
      writes: recording.writes(),
      result,
    });
  });

  it('fact extraction: processFactExtraction', async () => {
    const { processFactExtraction } = await import(
      '../handlers/fact-extraction'
    );

    const recording = recordingClient();

    const result = await processFactExtraction(
      factFixture.payload,
      recording.client,
    );

    expect(result.data.extractedCount).toBe(2);

    save('fact-extraction-old-writes.json', {
      writes: recording.writes(),
      result,
    });
  });
});
