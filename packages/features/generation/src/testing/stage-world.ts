/**
 * The world the stage tests and the stage matrix run against: a hand-built
 * episode context snapshot (what the worker's loader produces), a fake
 * database, and the ids the stages are run against. Test-only.
 */
import type { EpisodeContextSnapshot } from '../types';
import type { Responder } from './recording';
import { type RecordedCall, tableResponder } from './recording';

export const IDS = {
  accountId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  episodeId: '55555555-5555-4555-8555-555555555555',
  userId: '44444444-4444-4444-8444-444444444444',
  seasonId: '66666666-6666-4666-8666-666666666666',
};

export const SNAPSHOT: EpisodeContextSnapshot = {
  episodeNumber: 2,
  seasonNumber: 1,
  seasonPremise: 'Humanity builds its first deep-space relay.',
  seasonDirectionNotes: 'Keep every episode under ten minutes.',
  premise: 'A lonely astronaut hears a signal that should not exist.',
  genre: 'sci-fi',
  targetAudience: 'adults',
  visualStyle: 'cinematic',
  projectType: 'series',
  characters:
    'CHARACTER 1 — LOCKED IDENTITY:\n  Name: Maya Chen\n\nCHARACTER 2 — LOCKED IDENTITY:\n  Name: Director Williams',
  locations: '**Locations**:\n- **Observation Deck** (spacecraft interior)',
  previousEpisodes: '**Previous Episodes (for continuity)**:\n- Episode 1',
  previousEpisodeTitles: [{ number: 1, title: 'Launch Day' }],
  recurringElements: '---\n## RECURRING STORY ELEMENTS — ALL REQUIRED\n---',
  episodeFacts: '',
  verifiedFacts: undefined,
  characterNames: ['Maya Chen', 'Director Williams'],
  locationNames: ['Observation Deck'],
  counts: { characters: 2, locations: 1 },
};

export const CHARACTER_ASSETS = [
  { id: 'c1', name: 'Maya Chen', type: 'character' },
  { id: 'c2', name: 'Director Williams', type: 'character' },
];

export const TABLES: Record<string, unknown> = {
  episodes: {
    id: IDS.episodeId,
    project_id: IDS.projectId,
    number: 2,
    status: 'draft',
    deleted_at: null,
    version: 7,
    metadata: { character_ids: ['c1'] },
  },
  generation_jobs: { id: 'job-1', status: 'processing' },
  projects: {
    id: IDS.projectId,
    name: 'Relay',
    metadata: { genre: 'sci-fi', projectType: 'series' },
  },
  narrative_threads: [],
  verified_facts: [],
};

function has(call: RecordedCall, method: string) {
  return call.chain.some((step) => step.method === method);
}

/**
 * Serves `tables`, answers character asset reads with `CHARACTER_ASSETS`,
 * and returns one row for single reads of a list fixture.
 */
export function responder(
  tables: Record<string, unknown> = TABLES,
  options: { characterAssets?: unknown[]; episodesList?: unknown[] } = {},
): Responder {
  const base = tableResponder(tables);

  return (call) => {
    const isWrite = call.chain.some((step) =>
      ['insert', 'update', 'upsert', 'delete'].includes(step.method),
    );

    if (call.table === 'assets' && !isWrite) {
      return { data: options.characterAssets ?? CHARACTER_ASSETS };
    }

    if (call.table === 'assets') {
      const payload = call.chain.find((step) =>
        ['insert', 'upsert'].includes(step.method),
      )?.args[0];
      const rows = Array.isArray(payload) ? payload : [payload];
      return {
        data: rows.map((row, index) => ({
          id: `new-${index}`,
          ...(row as object),
        })),
      };
    }

    if (
      call.table === 'episodes' &&
      !isWrite &&
      !has(call, 'single') &&
      !has(call, 'maybeSingle')
    ) {
      return { data: options.episodesList ?? [tables.episodes] };
    }

    const response = base(call);

    if (
      response &&
      !isWrite &&
      Array.isArray(response.data) &&
      (has(call, 'single') || has(call, 'maybeSingle'))
    ) {
      return { data: response.data[0] ?? null };
    }

    return response;
  };
}
