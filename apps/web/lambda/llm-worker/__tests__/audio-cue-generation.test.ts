import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { recordingClient, tableResponder } from '@kit/generation/testing';

import fixture from '../../../../../packages/features/generation/__tests__/fixtures/audio-cues-fixture.json';
import audioOld from '../../../../../packages/features/generation/__tests__/fixtures/audio-cues-old-writes.json';
import {
  cuesByPart,
  processAudioCueGeneration,
} from '../handlers/audio-cue-generation';

type Cue = Parameters<typeof cuesByPart>[0][number];
const cues = fixture.cues as Cue[];

/**
 * The audio-cue handler on the `audio_cues` stage (FILM-1901): one
 * orchestrator run, its cues split by the scene of their first shot, then
 * the stage's check and commit. The writes are the ones the old handler made
 * for the same fixture (recorded before its body was deleted).
 *
 * KB-92: a cue takes its scene from the shot it starts on, and a shot's
 * scene is optional. A cue on a sceneless shot is saved with no scene,
 * beside every other cue; it is not dropped and not given a made-up scene 0.
 * `audio_cues.scene_number` accepting null is proven against the database by
 * `supabase/tests/database/audio-cue-scene-optional.test.sql`.
 */

const orchestratorInputs = vi.hoisted(() => [] as Array<{ shotsJson: string }>);

vi.mock('@kit/episodes/agent/audio-cue-orchestrator', () => ({
  runAudioCueOrchestrator: async (input: { shotsJson: string }) => {
    orchestratorInputs.push(input);
    return {
      success: true,
      cues: fixture.cues,
      verdict: 'pass',
      ...fixture.orchestrator,
    };
  },
}));

function pagedShots(shots: unknown[]) {
  const base = tableResponder({ shots });

  return recordingClient((call) => {
    const range = call.chain.find((step) => step.method === 'range');
    if (range && Number(range.args[0]) > 0) return { data: [] };
    return base(call);
  });
}

describe('processAudioCueGeneration', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(fixture.now));
  });

  afterAll(() => vi.useRealTimers());

  it('writes the rows the old handler wrote: a sceneless cue with no scene (KB-92), the cue on a missing shot dropped', async () => {
    const recording = pagedShots(fixture.shots);

    const result = await processAudioCueGeneration(
      fixture.ids,
      recording.client,
    );

    expect(result).toEqual({ success: true, cuesCreated: 4 });
    expect(orchestratorInputs).toHaveLength(1);
    expect(JSON.parse(orchestratorInputs[0]!.shotsJson)).toHaveLength(4);

    const sorted = (writes: unknown[]) =>
      writes
        .map((w) => JSON.parse(JSON.stringify(w)) as unknown)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

    expect(sorted(recording.writes())).toEqual(sorted(audioOld.writes));

    const inserted = recording.writes().find((w) => w.table === 'audio_cues')!
      .payload as Array<Record<string, unknown>>;

    expect(inserted.map((row) => [row.prompt, row.scene_number])).toEqual([
      ['Quiet office atmosphere, air conditioning hum', 1],
      ['Cinematic strings, suspenseful, 70 BPM, in D minor', 1],
      ['Footsteps echoing in a concrete car park', 2],
      ['Phone screen chime', null],
    ]);
  });

  it('fails the job, with the part and the field, when the orchestrator names a cue type the prompt does not define', async () => {
    const recording = pagedShots(fixture.shots);
    const orchestrator = await import(
      '@kit/episodes/agent/audio-cue-orchestrator'
    );
    const spy = vi
      .spyOn(orchestrator, 'runAudioCueOrchestrator')
      .mockResolvedValueOnce({
        success: true,
        orchestratorSteps: 1,
        cues: [{ ...fixture.cues[0]!, type: 'voice' as never }],
      });

    await expect(
      processAudioCueGeneration(fixture.ids, recording.client),
    ).rejects.toThrow(
      /audio_cues output for part scene:1 rejected: cues\.0\.type invalid_enum_value/,
    );

    expect(recording.writes().map((w) => [w.table, w.op])).toEqual([
      ['generation_jobs', 'update'],
      ['generation_jobs', 'update'],
    ]);
    expect(recording.writes()[1]!.payload).toMatchObject({ status: 'failed' });

    spy.mockRestore();
  });
});

describe('cuesByPart', () => {
  const groups = [
    {
      partKey: 'scene:1',
      sceneNumber: 1,
      shotSequences: [1, 2],
      durationSeconds: 11,
    },
    {
      partKey: 'scene:none',
      sceneNumber: null,
      shotSequences: [4],
      durationSeconds: 4,
    },
  ];

  it('files each cue under the scene of its first shot and drops one on a shot the episode lacks', () => {
    const parts = cuesByPart(
      [
        { ...cues[0]!, startShotSequence: 2 },
        { ...cues[3]!, startShotSequence: 4 },
        { ...cues[4]!, startShotSequence: 9 },
      ],
      { groups },
    );

    expect([...parts.keys()]).toEqual(['scene:1', 'scene:none']);
    expect(parts.get('scene:1')).toHaveLength(1);
    expect(parts.get('scene:none')).toHaveLength(1);
  });
});
