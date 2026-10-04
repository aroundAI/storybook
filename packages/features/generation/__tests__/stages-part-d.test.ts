import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type AudioCueGenerationOutput,
  type FactExtractionOutput,
  reelNoteFor,
} from '@kit/prompt-engine/schemas';

import {
  StageOutputRejected,
  audioCuesStage,
  checkWithSchema,
  episodeSummaryStage,
  factExtractionStage,
  getStage,
  runStage,
  shotsStage,
  singlePart,
} from '../src';
import type { ShotsPartOutput } from '../src/stages/shots';
import { recordingClient, tableResponder } from '../src/testing';
import summaryFixture from '../src/testing/fixtures/episode-summary-fixture.json';
import factFixture from '../src/testing/fixtures/fact-extraction-fixture.json';
import {
  audioFixture,
  audioPartOutputs,
  comparable,
  ctxFor,
  episodeFixture,
  generateFrom,
  pagedResponder,
  shotsOutput,
  shotsPartOutputs,
} from '../src/testing/part-d';
import type { Brief, PartSpec } from '../src/types';
import audioOld from './fixtures/audio-cues-old-writes.json';
import summaryOld from './fixtures/episode-summary-old.json';
import factOld from './fixtures/fact-extraction-old-writes.json';
import shotsOld from './fixtures/shots-old-writes.json';

/**
 * FILM-1901 part D: shots, audio_cues, fact_extraction and episode_summary.
 *
 * Parity: the fixture model output the OLD handlers were recorded with
 * (`fixtures/*-old-writes.json`, captured before their bodies were deleted)
 * runs through the new stage, and the writes must be the same rows.
 */

const shotsTarget = {
  ...episodeFixture.ids,
  shotDuration: episodeFixture.shotDuration,
};

const scenePart = (sceneNumber: number): PartSpec => ({
  key: `scene:${sceneNumber}`,
  index: sceneNumber,
  total: 3,
  label: `Scene ${sceneNumber}`,
});

const reelPart: PartSpec = {
  key: 'reel_scout',
  index: 0,
  total: 3,
  label: 'Reel Scout',
};

const NO_TEMPLATE_VARIABLE = /\{\{\s*\w+\s*\}\}/;

beforeAll(() => {
  // Date only: the stages write timestamps; the recordings were made at `now`
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(episodeFixture.now));
});

afterAll(() => vi.useRealTimers());

function shotsClient() {
  return recordingClient(
    tableResponder({
      episodes: episodeFixture.episode,
      shots: episodeFixture.existingShots,
    }),
  );
}

describe('registry', () => {
  it('registers the four part-D stages', () => {
    expect(getStage('shots')).toBe(shotsStage);
    expect(getStage('audio_cues')).toBe(audioCuesStage);
    expect(getStage('fact_extraction')).toBe(factExtractionStage);
    expect(getStage('episode_summary')).toBe(episodeSummaryStage);
  });
});

describe('shots stage', () => {
  it('has a reel-scout part, then one part per scene, in screenplay order', async () => {
    const parts = await shotsStage.parts(
      ctxFor(shotsClient().client),
      shotsTarget,
    );

    expect(parts.map((p) => [p.key, p.index, p.total])).toEqual([
      ['reel_scout', 0, 3],
      ['scene:1', 1, 3],
      ['scene:2', 2, 3],
    ]);
    expect(parts[2]!.label).toBe('Scene 2: EXT. THE CAR PARK - NIGHT');
  });

  it('renders both prompts with every variable filled, each brief carrying its own part schema', async () => {
    const ctx = ctxFor(shotsClient().client);
    const reel = await shotsStage.prepare(ctx, shotsTarget, reelPart);
    const scene = await shotsStage.prepare(ctx, shotsTarget, scenePart(2));

    expect(reel.prompt.slug).toBe('reel-scout');
    expect(reel.instructions).not.toMatch(NO_TEMPLATE_VARIABLE);
    expect(reel.instructions).toContain('**Total Scene Count**: 2');
    expect(reel.outputSchema).toMatchObject({
      properties: { kind: { const: 'reel_scout' } },
    });

    expect(scene.prompt.slug).toBe('scene-shot-generation');
    expect(scene.instructions).not.toMatch(NO_TEMPLATE_VARIABLE);
    expect(scene.instructions).toContain('Scene 2 of 2');
    expect(scene.instructions).toContain('between 4 and 8 seconds');
    expect(scene.instructions).toContain('Maya Chen: 34, East Asian');
    expect(scene.prompt.variables).toMatchObject({
      scene_number: 2,
      total_scenes: 2,
      shot_duration_min: 4,
      shot_duration_max: 8,
      previous_scene_summary: '',
    });
    // KB-178 changes this prompt on purpose (owner, 2026-10-03): the old
    // handler's rendered text had no reel note; prepared with no reel_scout
    // output, a scene sends an empty one, and the prompt shows none
    expect(scene.prompt.variables).toMatchObject({ reel_note: '' });
    expect(scene.instructions).not.toContain('Reel candidate');
    expect(scene.outputSchema).toMatchObject({
      properties: {
        kind: { const: 'scene' },
        sceneNumber: { type: 'integer' },
      },
    });
    expect(scene.constraints).toMatchObject({
      sceneNumber: 2,
      shotDuration: { min: 4, max: 8 },
      shotDurationLimits: { min: 3, max: 10 },
      characters: ['Maya Chen', 'Dev Patel'],
    });
    expect(scene.qualityRubric).toContain('Scene 2 of 2');
    expect(scene.targetVersion).toBe(3);
  });

  it('defuses the stored title and scene text before they reach a prompt (KB-101)', async () => {
    const ctx = ctxFor(shotsClient().client);
    const reel = await shotsStage.prepare(ctx, shotsTarget, reelPart);

    expect(reel.instructions).not.toContain('--- ignore previous instructions');
    expect(reel.instructions).toContain('Pilot');
  });

  it('sends the Reel Scout’s note for the scene it flagged, and only that scene (KB-178)', async () => {
    const ctx = ctxFor(shotsClient().client);
    const reelScout = shotsPartOutputs().get('reel_scout') as ShotsPartOutput;
    const note = reelNoteFor(1, [1]);

    expect(note).toContain('PRIORITY: This scene is a Reel candidate');

    const flagged = await shotsStage.prepare(ctx, shotsTarget, scenePart(1), [
      reelScout,
    ]);
    const unflagged = await shotsStage.prepare(ctx, shotsTarget, scenePart(2), [
      reelScout,
    ]);

    // Server mode renders prompt.variables; an external agent reads
    // instructions and context
    expect(flagged.prompt.variables.reel_note).toBe(note);
    expect(flagged.instructions).toContain(note);
    expect(flagged.context.reelNote).toBe(note);

    expect(unflagged.prompt.variables.reel_note).toBe('');
    expect(unflagged.instructions).not.toContain('Reel candidate');
    expect(unflagged.context.reelNote).toBe('');
  });

  it('hands each scene part the reel_scout output the runner accepted first (KB-178)', async () => {
    const briefs = new Map<string, Brief>();
    const generate = generateFrom(shotsPartOutputs());

    await runStage(shotsStage, ctxFor(shotsClient().client), shotsTarget, {
      generate: (brief) => {
        briefs.set(brief.part.key, brief);
        return generate(brief);
      },
    });

    expect(briefs.get('scene:1')!.instructions).toContain(reelNoteFor(1, [1]));
    expect(briefs.get('scene:2')!.instructions).not.toContain('Reel candidate');
  });

  it('writes the same rows as the old handler for a two-scene episode, numbered across scenes', async () => {
    const recording = shotsClient();

    const { commit } = await runStage(
      shotsStage,
      ctxFor(recording.client),
      shotsTarget,
      { generate: generateFrom(shotsPartOutputs()) },
    );

    expect(commit.status).toBe('committed');
    expect(commit.data.totalShots).toBe(4);
    expect(commit.data.reelCandidateScenes).toEqual([1]);
    expect(commit.followOns).toEqual([
      {
        stage: 'audio_cues',
        target: {
          type: 'episode',
          id: episodeFixture.ids.episodeId,
          projectId: episodeFixture.ids.projectId,
          input: { kind: 'stage', target: episodeFixture.ids },
        },
      },
    ]);

    // The old handler queued the audio job itself; that row is the chain,
    // which the worker still writes after commit (see the handler test).
    const oldWrites = shotsOld.writes.filter(
      (w) => !(w.table === 'generation_jobs' && w.op === 'insert'),
    );

    expect(comparable(recording.writes())).toEqual(
      comparable(oldWrites as never),
    );

    const inserted = recording
      .writes()
      .find((w) => w.table === 'shots' && w.op === 'insert')!.payload as Array<
      Record<string, unknown>
    >;

    expect(
      inserted.map((r) => [r.scene_number, r.shot_number, r.sequence_number]),
    ).toEqual([
      [1, 1, 6],
      [1, 2, 7],
      [2, 3, 8],
      [2, 4, 9],
    ]);
  });

  it('skips every write, and says so on the job, when the episode was deleted meanwhile', async () => {
    const recording = recordingClient(
      tableResponder({
        episodes: { ...episodeFixture.episode, deleted_at: '2026-10-03' },
        shots: [],
      }),
    );

    const { commit } = await runStage(
      shotsStage,
      ctxFor(recording.client),
      shotsTarget,
      { generate: generateFrom(shotsPartOutputs()) },
    );

    expect(commit.status).toBe('skipped');
    expect(commit.followOns).toBeUndefined();
    expect(recording.writes().map((w) => [w.table, w.op])).toEqual([
      ['generation_jobs', 'update'],
      ['generation_jobs', 'update'],
    ]);
    expect(recording.writes()[1]!.payload).toMatchObject({
      status: 'completed',
      output_data: { skipped: true, reason: 'episode-deleted' },
    });
  });

  it('stamps the origin on every shot only when the columns exist', async () => {
    const recording = shotsClient();

    await runStage(
      shotsStage,
      ctxFor(recording.client, { originColumnsAvailable: true }),
      shotsTarget,
      { generate: generateFrom(shotsPartOutputs()) },
    );

    const inserted = recording
      .writes()
      .find((w) => w.table === 'shots' && w.op === 'insert')!.payload as Array<
      Record<string, unknown>
    >;

    expect(inserted.every((r) => r.generation_origin)).toBe(true);
    expect(inserted[0]!.generation_origin).toMatchObject({
      kind: 'server',
      promptSlug: 'scene-shot-generation',
    });
  });

  describe('check()', () => {
    const ctx = () => ctxFor(shotsClient().client);
    const scene1 = shotsPartOutputs().get('scene:1') as {
      kind: 'scene';
      sceneNumber: number;
      shots: Array<Record<string, unknown>>;
    };
    const shot = () =>
      JSON.parse(JSON.stringify(scene1.shots[0])) as Record<string, unknown> & {
        veoPrompt: Record<string, unknown>;
        metadata: Record<string, unknown>;
      };

    const codes = (errors: Array<{ path: string; code: string }>) =>
      errors.map((e) => [e.path, e.code]);

    it('refuses a shot longer than SHOT_DURATION_LIMITS at the schema', () => {
      const result = checkWithSchema(shotsStage.outputSchema, {
        ...scene1,
        shots: [{ ...shot(), duration: 12 }],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toEqual([
        {
          path: 'shots.0.duration',
          code: 'too_big',
          message: expect.stringContaining('10'),
        },
      ]);
    });

    it('refuses a shot outside the range this episode asked for', async () => {
      const errors = await shotsStage.check(
        ctx(),
        shotsTarget,
        { ...scene1, shots: [{ ...shot(), duration: 9 }] } as never,
        scenePart(1),
      );

      expect(codes(errors)).toEqual([
        ['shots.0.duration', 'duration_out_of_range'],
      ]);
    });

    it('refuses a character the episode does not have, and a location the scene does not have', async () => {
      const bad = shot();
      bad.characters = ['Maya Chen', 'Zed'];
      bad.metadata = { ...bad.metadata, location: 'The Moon' };

      const errors = await shotsStage.check(
        ctx(),
        shotsTarget,
        { ...scene1, shots: [bad] } as never,
        scenePart(1),
      );

      expect(codes(errors)).toEqual([
        ['shots.0.characters', 'unknown_character'],
        ['shots.0.metadata.location', 'unknown_location'],
      ]);
      expect(errors[0]!.message).toContain('"Zed"');
    });

    it('accepts a first name and a scene heading as references', async () => {
      const ok = shot();
      ok.characters = ['maya'];
      ok.metadata = { ...ok.metadata, location: 'INT. THE OFFICE - MORNING' };

      expect(
        await shotsStage.check(
          ctx(),
          shotsTarget,
          { ...scene1, shots: [ok] } as never,
          scenePart(1),
        ),
      ).toEqual([]);
    });

    it('refuses a VEO prompt missing a component or its negative prompt', async () => {
      const bad = shot();
      bad.veoPrompt = {
        ...bad.veoPrompt,
        audio: '  ',
        timeline: [],
        avoid: '',
      };

      const errors = await shotsStage.check(
        ctx(),
        shotsTarget,
        { ...scene1, shots: [bad] } as never,
        scenePart(1),
      );

      expect(codes(errors)).toEqual([
        ['shots.0.veoPrompt.audio', 'missing_veo_component'],
        ['shots.0.veoPrompt.timeline', 'missing_veo_component'],
        ['shots.0.veoPrompt.avoid', 'missing_negative_prompt'],
      ]);
    });

    it('refuses an empty scene, a scene submitted for the wrong part, and a part of the wrong kind', async () => {
      expect(
        codes(
          await shotsStage.check(
            ctx(),
            shotsTarget,
            { ...scene1, shots: [] } as never,
            scenePart(1),
          ),
        ),
      ).toEqual([['shots', 'too_few_shots']]);

      expect(
        codes(
          await shotsStage.check(
            ctx(),
            shotsTarget,
            scene1 as never,
            scenePart(2),
          ),
        ),
      ).toEqual([['sceneNumber', 'wrong_scene']]);

      expect(
        codes(
          await shotsStage.check(ctx(), shotsTarget, scene1 as never, reelPart),
        ),
      ).toEqual([['kind', 'wrong_part']]);
    });

    it('refuses a reel-scout analysis of a scene the screenplay does not have', async () => {
      const reel = shotsPartOutputs().get('reel_scout') as {
        sceneAnalyses: Array<Record<string, unknown>>;
        topReelCandidates: number[];
      };

      const errors = await shotsStage.check(
        ctx(),
        shotsTarget,
        {
          ...reel,
          sceneAnalyses: [{ ...reel.sceneAnalyses[0], sceneNumber: 7 }],
          topReelCandidates: [7],
        } as never,
        reelPart,
      );

      expect(codes(errors)).toEqual([
        ['sceneAnalyses.0.sceneNumber', 'unknown_scene'],
        ['topReelCandidates.0', 'unknown_scene'],
      ]);
    });

    it('is what the runner enforces: a bad scene fails the stage and the job', async () => {
      const recording = shotsClient();
      const outputs = shotsPartOutputs();
      outputs.set('scene:2', {
        ...(outputs.get('scene:2') as object),
        shots: [],
      });

      await expect(
        runStage(shotsStage, ctxFor(recording.client), shotsTarget, {
          generate: generateFrom(outputs),
        }),
      ).rejects.toThrow(StageOutputRejected);

      expect(recording.writes().map((w) => [w.table, w.op])).toEqual([
        ['generation_jobs', 'update'],
        ['generation_jobs', 'update'],
      ]);
      expect(recording.writes()[1]!.payload).toMatchObject({
        status: 'failed',
        error_message: expect.stringContaining('too_few_shots'),
      });
    });
  });
});

describe('audio_cues stage', () => {
  const target = audioFixture.ids;

  function audioClient() {
    return recordingClient(pagedResponder({ shots: audioFixture.shots }));
  }

  it('has one part per scene of the shot list, sceneless shots last as their own part', async () => {
    const parts = await audioCuesStage.parts(
      ctxFor(audioClient().client),
      target,
    );

    expect(parts.map((p) => [p.key, p.label])).toEqual([
      ['scene:1', 'Scene 1'],
      ['scene:2', 'Scene 2'],
      ['scene:none', 'Shots without a scene'],
    ]);
  });

  it('renders the audio prompt for one scene with every variable filled', async () => {
    const parts = await audioCuesStage.parts(
      ctxFor(audioClient().client),
      target,
    );
    const brief = await audioCuesStage.prepare(
      ctxFor(audioClient().client),
      target,
      parts[0]!,
    );

    expect(brief.prompt.slug).toBe('scene-audio-refinement');
    expect(brief.instructions).not.toMatch(NO_TEMPLATE_VARIABLE);
    expect(brief.instructions).toContain('shots for Scene 1');
    expect(brief.prompt.variables.shots_json).toContain('"seq":1');
    expect(brief.prompt.variables.shots_json).not.toContain('"seq":3');
    expect(brief.context).toMatchObject({ totalDurationSeconds: 23 });
    expect(brief.constraints).toMatchObject({
      shots: [
        { seq: 1, duration: 6 },
        { seq: 2, duration: 5 },
      ],
    });
  });

  it('writes the same cue rows as the old handler, a sceneless cue with no scene (KB-92)', async () => {
    const recording = audioClient();

    const { commit } = await runStage(
      audioCuesStage,
      ctxFor(recording.client),
      target,
      {
        generate: generateFrom(audioPartOutputs(), {
          diagnostics: {
            orchestratorSteps: 3,
            coveragePercent: 92,
            batchedByScene: false,
          },
        }),
      },
    );

    expect(commit).toEqual({ status: 'committed', data: { cuesCreated: 4 } });
    expect(comparable(recording.writes())).toEqual(
      comparable(audioOld.writes as never),
    );
  });

  describe('check()', () => {
    const part = (key: string): PartSpec => ({
      key,
      index: 0,
      total: 3,
      label: key,
    });
    const cue = {
      ...audioFixture.cues[0]!,
      startShotSequence: 1,
    } as AudioCueGenerationOutput['cues'][number];

    it('refuses a cue on a shot outside the part, an offset past the shot, and a cue that lasts nothing', async () => {
      const errors = await audioCuesStage.check(
        ctxFor(audioClient().client),
        target,
        {
          cues: [
            { ...cue, startShotSequence: 9 },
            { ...cue, startShotSequence: 3 },
            { ...cue, startOffsetInShot: 6.5 },
            { ...cue, durationSeconds: 0 },
          ],
        },
        part('scene:1'),
      );

      expect(errors.map((e) => [e.path, e.code])).toEqual([
        ['cues.0.startShotSequence', 'unknown_shot'],
        ['cues.1.startShotSequence', 'unknown_shot'],
        ['cues.2.startOffsetInShot', 'offset_outside_shot'],
        ['cues.3.durationSeconds', 'non_positive_duration'],
      ]);
    });

    it('refuses a cue type the prompt does not define at the schema, and defaults a missing offset', () => {
      const bad = checkWithSchema(audioCuesStage.outputSchema, {
        cues: [{ ...cue, type: 'voice' }],
      });
      expect(bad.ok).toBe(false);
      if (!bad.ok) {
        expect(bad.errors[0]).toMatchObject({
          path: 'cues.0.type',
          code: 'invalid_enum_value',
        });
      }

      const { startOffsetInShot: _omitted, ...withoutOffset } = cue;
      const ok = checkWithSchema(audioCuesStage.outputSchema, {
        cues: [withoutOffset],
      });
      expect(ok.ok && ok.value.cues[0]!.startOffsetInShot).toBe(0);
    });
  });
});

describe('fact_extraction stage', () => {
  const target = factFixture.payload;

  it('renders the fact-extraction prompt with the source defused, every variable filled', async () => {
    const brief = await factExtractionStage.prepare(
      ctxFor(recordingClient().client),
      target,
      singlePart('facts', 'Facts'),
    );

    expect(brief.prompt.slug).toBe('fact-extraction');
    expect(brief.instructions).not.toMatch(NO_TEMPLATE_VARIABLE);
    expect(brief.instructions).toContain(
      '**Source Citation**: Environment Agency, 2019',
    );
    expect(brief.instructions).not.toContain('```ignore');
    expect(brief.instructions).toContain('The Thames Barrier opened in 1982.');
    expect(brief.constraints).toMatchObject({ maxFacts: 30 });
  });

  it('writes the same verified_facts rows as the old handler', async () => {
    const recording = recordingClient();

    const { commit } = await runStage(
      factExtractionStage,
      ctxFor(recording.client),
      target,
      {
        generate: async () => ({ output: factFixture.modelOutput }),
      },
    );

    expect(commit.status).toBe('committed');
    expect(commit.data).toEqual(factOld.result.data);
    expect(comparable(recording.writes())).toEqual(
      comparable(factOld.writes as never),
    );
  });

  it('writes nothing, and says so, when the source yields no facts', async () => {
    const recording = recordingClient();

    const { commit } = await runStage(
      factExtractionStage,
      ctxFor(recording.client),
      target,
      { generate: async () => ({ output: { facts: [] } }) },
    );

    expect(commit).toMatchObject({
      status: 'skipped',
      data: { extractedCount: 0 },
    });
    expect(recording.writes()).toEqual([]);
  });

  it('refuses an empty claim, and a category the prompt does not define', async () => {
    const [fact] = factFixture.modelOutput
      .facts as FactExtractionOutput['facts'];

    expect(
      await factExtractionStage.check(
        ctxFor(recordingClient().client),
        target,
        { facts: [{ ...fact!, claim: '  ' }] },
        singlePart('facts', 'Facts'),
      ),
    ).toEqual([
      {
        path: 'facts.0.claim',
        code: 'empty_claim',
        message: 'A fact needs a claim',
      },
    ]);

    const bad = checkWithSchema(factExtractionStage.outputSchema, {
      facts: [{ ...fact, category: 'rumour' }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors[0]).toMatchObject({
        path: 'facts.0.category',
        code: 'invalid_enum_value',
      });
    }
  });
});

describe('episode_summary stage', () => {
  const target = summaryFixture.input;

  function summaryClient() {
    return recordingClient(
      tableResponder({
        narrative_threads: summaryFixture.threads,
        assets: summaryFixture.characters,
      }),
    );
  }

  it('renders canon-extraction with the very variables the action rendered', async () => {
    const brief = await episodeSummaryStage.prepare(
      ctxFor(summaryClient().client),
      target,
      singlePart('extraction', 'Extraction'),
    );

    expect(brief.prompt.slug).toBe('canon-extraction');
    expect(brief.prompt.variables).toEqual(summaryOld.executeLLM.variables);
    expect(brief.instructions).not.toMatch(NO_TEMPLATE_VARIABLE);
    expect(brief.instructions).toContain(
      '- "The Missing Report" (mystery, open)',
    );
  });

  it('returns the extraction the action returned, and writes nothing: the canon write stays behind review', async () => {
    const recording = summaryClient();

    const { commit } = await runStage(
      episodeSummaryStage,
      ctxFor(recording.client),
      target,
      { generate: async () => ({ output: summaryFixture.modelOutput }) },
    );

    expect(commit.status).toBe('skipped');
    expect(commit.reason).toContain('commitCanonChangesAction');
    expect(JSON.parse(JSON.stringify(commit.data))).toEqual(summaryOld.result);
    expect(recording.writes()).toEqual(summaryOld.writes);
    expect(recording.writes()).toEqual([]);
  });

  it('refuses an event without a key, and at the schema an output without an extraction', async () => {
    const extraction = summaryFixture.modelOutput.extraction;

    expect(
      await episodeSummaryStage.check(
        ctxFor(summaryClient().client),
        target,
        {
          extraction: {
            ...extraction,
            immutableEvents: [
              { ...extraction.immutableEvents[0]!, eventKey: '' },
            ],
          },
        } as never,
        singlePart('extraction', 'Extraction'),
      ),
    ).toEqual([
      {
        path: 'extraction.immutableEvents.0.eventKey',
        code: 'empty_event_key',
        message: 'An immutable event needs a key',
      },
    ]);

    const bad = checkWithSchema(episodeSummaryStage.outputSchema, {
      summary: 'not the shape',
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors).toEqual([
        { path: 'extraction', code: 'invalid_type', message: 'Required' },
      ]);
    }
  });
});

describe('time', () => {
  it('the recordings were made at the fixture’s clock', () => {
    expect(episodeFixture.now).toBe(audioFixture.now);
  });
});
