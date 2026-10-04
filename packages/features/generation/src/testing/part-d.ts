import type { Ctx, EpisodeContextLoader, GenerateFn } from '../types';
import audioFixture from './fixtures/audio-cues-fixture.json';
import summaryFixture from './fixtures/episode-summary-fixture.json';
import factFixture from './fixtures/fact-extraction-fixture.json';
import episodeFixture from './fixtures/shots-episode.json';
import shotsOutput from './fixtures/shots-model-output.json';
import {
  type RecordedWrite,
  type Responder,
  recordCommits,
  tableResponder,
} from './recording';

export {
  audioFixture,
  episodeFixture,
  factFixture,
  shotsOutput,
  summaryFixture,
};

/**
 * `tableResponder`, except that a paged read (`.range(from, to)`) past the
 * first page answers with no rows, so `fetchAllRows` stops.
 */
export function pagedResponder(fixtures: Record<string, unknown>): Responder {
  const base = tableResponder(fixtures);

  return (call) => {
    const range = call.chain.find((step) => step.method === 'range');

    if (range && Number(range.args[0]) > 0) return { data: [] };

    return base(call);
  };
}

/** The part outputs the shots fixture stands for, keyed by part. */
export function shotsPartOutputs(): Map<string, unknown> {
  const outputs = new Map<string, unknown>();

  outputs.set('reel_scout', { kind: 'reel_scout', ...shotsOutput.reelScout });

  for (const scene of shotsOutput.scenes) {
    outputs.set(`scene:${scene.sceneNumber}`, { kind: 'scene', ...scene });
  }

  return outputs;
}

/** The audio fixture's cues that start on a shot the episode has, by part. */
export function audioPartOutputs(): Map<string, unknown> {
  const sceneOf = new Map(
    audioFixture.shots.map((s) => [s.sequence_number, s.scene_number]),
  );
  const outputs = new Map<string, { cues: unknown[] }>();

  for (const cue of audioFixture.cues) {
    if (!sceneOf.has(cue.startShotSequence)) continue;

    const scene = sceneOf.get(cue.startShotSequence);
    const key = scene === null ? 'scene:none' : `scene:${scene}`;
    const part = outputs.get(key) ?? { cues: [] };

    part.cues.push(cue);
    outputs.set(key, part);
  }

  return outputs;
}

/** A `generate` that answers each part from a prepared map. */
export function generateFrom(
  outputs: Map<string, unknown>,
  extras: { diagnostics?: Record<string, unknown> } = {},
): GenerateFn {
  let first = true;

  return async (brief) => {
    const output = outputs.get(brief.part.key);

    if (output === undefined) {
      throw new Error(`No fixture output for part ${brief.part.key}`);
    }

    const diagnostics = first ? extras.diagnostics : undefined;
    first = false;

    return { output, diagnostics };
  };
}

export const fixtureEpisodeContext: EpisodeContextLoader = async () => ({
  episodeNumber: 1,
  characters: '',
  locations: '',
  previousEpisodes: '',
  counts: {
    characters: episodeFixture.context.characters.length,
    locations: episodeFixture.context.locations.length,
  },
  charactersVeo: episodeFixture.context.charactersVeo,
  locationsVeo: episodeFixture.context.locationsVeo,
  recurringElements: episodeFixture.context.recurringElementsFormatted,
  characterNames: episodeFixture.context.characters.map((c) => c.name),
  locationNames: episodeFixture.context.locations.map((l) => l.name),
  genre: episodeFixture.context.genre,
  targetAudience: episodeFixture.context.targetAudience,
  visualStyle: episodeFixture.context.visualStyle,
});

export function ctxFor(
  client: Ctx['client'],
  overrides: Partial<Ctx> = {},
): Ctx {
  return {
    client,
    accountId: episodeFixture.ids.accountId,
    userId: episodeFixture.ids.userId,
    episodeContext: fixtureEpisodeContext,
    log: () => undefined,
    commits: recordCommits(client).apply,
    ...overrides,
  };
}

/** Writes as JSON would carry them, in a stable order, for comparison. */
export function comparable(writes: RecordedWrite[]): unknown[] {
  return writes
    .map((write) => JSON.parse(JSON.stringify(write)) as unknown)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
