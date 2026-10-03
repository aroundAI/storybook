/**
 * FILM-1901 part B: the story, ideation, season-outline and season-analysis
 * handlers, rewritten as prepare → orchestrator → commit on @kit/generation,
 * do what the old handlers did.
 *
 * `fixtures/*-parity.json` holds what the old handlers produced for the
 * inputs in helpers/stage-parity.ts, recorded by running the old handler
 * bodies (as of commit 9dbaba396, which holds the recorder) before they
 * were deleted: the executor input each one built, every write it issued,
 * and its result. The rewritten handlers run here with the
 * same inputs and mocks, and must produce the same.
 *
 * Where the new commit writes something the old handler did not (ideas on
 * the episode, outline rows, the analysis on the project), the test says so
 * and pins the new write.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { episodeRowFromOutline } from '@kit/generation/episode-rows';
import { type RecordedWrite, recordingClient } from '@kit/generation/testing';

import {
  CANON_EXTRACTION,
  EPISODE_CONTEXT,
  IDEATION_ORCHESTRATOR_RESULT,
  IDEATION_PAYLOAD,
  IDS,
  NOW,
  SEASON_ANALYSIS_PAYLOAD,
  SEASON_ANALYSIS_RESULT,
  SEASON_OUTLINE_ORCHESTRATOR_RESULT,
  SEASON_OUTLINE_PAYLOAD,
  STORY_ORCHESTRATOR_RESULT,
  STORY_PAYLOAD,
  TABLES,
  parityResponder,
} from './helpers/stage-parity';

const seen: Record<string, unknown> = {};

vi.mock('../utils/context-builder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/context-builder')>()),
  buildEpisodeContext: vi.fn(async () => EPISODE_CONTEXT),
}));
vi.mock('@kit/episodes/agent/story-orchestrator', () => ({
  runStoryOrchestrator: vi.fn(async (input: unknown) => {
    seen.story = input;
    return STORY_ORCHESTRATOR_RESULT;
  }),
}));
vi.mock('@kit/episodes/agent/ideation-orchestrator', () => ({
  runIdeationOrchestrator: vi.fn(async (input: unknown) => {
    seen.ideation = input;
    return IDEATION_ORCHESTRATOR_RESULT;
  }),
}));
vi.mock('@kit/episodes/agent/season-orchestrator', () => ({
  runSeasonOrchestrator: vi.fn(async (input: unknown) => {
    seen.season_outline = input;
    return SEASON_OUTLINE_ORCHESTRATOR_RESULT;
  }),
}));
vi.mock('@kit/prompt-engine/server', () => ({
  executeLLM: vi.fn(async (input: unknown) => {
    seen['canon-extraction'] = input;
    return { data: { extraction: CANON_EXTRACTION } };
  }),
}));
vi.mock('../llm-utils', () => ({
  executeLLMForLambda: vi.fn(async (input: unknown) => {
    seen.season_analysis = input;
    return {
      data: SEASON_ANALYSIS_RESULT,
      metadata: { tokens: 10, latency: 5, provider: 'gemini', model: 'g' },
    };
  }),
}));

interface Fixture {
  executorInput: unknown;
  canonExtractionInput?: unknown;
  writes: RecordedWrite[];
  result: unknown;
}

function fixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(
      path.resolve(__dirname, 'fixtures', `${name}-parity.json`),
      'utf8',
    ),
  ) as Fixture;
}

/** JSON round trip: drops undefined, as the captured fixture did. */
function json<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('the rewritten handlers do what the old ones did (FILM-1901)', () => {
  beforeEach(() => {
    for (const key of Object.keys(seen)) delete seen[key];
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  describe('story', () => {
    it('hands the Story Orchestrator the same input, extracts canon facts the same way, writes the same rows and returns the same result', async () => {
      const old = fixture('story');
      const { processStoryGeneration } = await import(
        '../handlers/story-generation'
      );
      const db = recordingClient(parityResponder());

      const result = await processStoryGeneration(STORY_PAYLOAD, db.client);

      expect(json(seen.story)).toEqual(old.executorInput);
      expect(json(seen['canon-extraction'])).toEqual(old.canonExtractionInput);
      expect(json(db.writes())).toEqual(old.writes);
      expect(json(result)).toEqual(old.result);
    });

    it('writes story_data, the status, the job bookkeeping, the canon and the invented assets, in that order', async () => {
      const { processStoryGeneration } = await import(
        '../handlers/story-generation'
      );
      const db = recordingClient(parityResponder());

      await processStoryGeneration(STORY_PAYLOAD, db.client);

      expect(db.writes().map((w) => `${w.table}:${w.op}`)).toEqual([
        'generation_jobs:update',
        'episodes:update',
        'generation_jobs:update',
        'immutable_events:delete',
        'character_states:delete',
        'narrative_threads:delete',
        'immutable_events:insert',
        'character_states:insert',
        'episodes:update',
        'narrative_threads:insert',
        'narrative_threads:update',
        'episode_summaries:upsert',
        'world_states:insert',
        'assets:upsert',
        'assets:upsert',
        'episodes:update',
      ]);
    });
  });

  describe('ideation', () => {
    it('hands the Ideation Orchestrator the same input and returns the same result', async () => {
      const old = fixture('ideation');
      const { processStoryIdeation } = await import(
        '../handlers/story-ideation'
      );
      const db = recordingClient(parityResponder());

      const result = await processStoryIdeation(IDEATION_PAYLOAD, db.client);

      expect(json(seen.ideation)).toEqual(old.executorInput);
      expect(json(result)).toEqual(old.result);
    });

    it('stores the ideas on episodes.metadata.ideas, which the old handler did not (lead decision, 2026-10-03)', async () => {
      const old = fixture('ideation');
      expect(old.writes).toEqual([]);

      const { processStoryIdeation } = await import(
        '../handlers/story-ideation'
      );
      const db = recordingClient(parityResponder());

      await processStoryIdeation(IDEATION_PAYLOAD, db.client);

      expect(db.writes()).toEqual([
        expect.objectContaining({
          table: 'episodes',
          op: 'update',
          payload: {
            metadata: {
              ...(TABLES.episodes as { metadata: object }).metadata,
              ideas: IDEATION_ORCHESTRATOR_RESULT.ideas,
              ideas_generated_at: NOW.toISOString(),
            },
          },
          filters: [
            { method: 'eq', args: ['id', IDS.episodeId] },
            { method: 'is', args: ['deleted_at', null] },
          ],
        }),
      ]);
    });
  });

  describe('season outline', () => {
    it('hands the Season Orchestrator the same input and returns the same outlines, each with its row', async () => {
      const old = fixture('season-outline');
      const { processSeasonOutline } = await import(
        '../handlers/season-outline'
      );
      const db = recordingClient(parityResponder());

      const result = await processSeasonOutline(
        SEASON_OUTLINE_PAYLOAD,
        db.client,
      );

      expect(json(seen.season_outline)).toEqual(old.executorInput);

      const oldResult = old.result as {
        data: { episodes: unknown[]; metadata: unknown };
      };
      expect(result.data.metadata).toEqual(oldResult.data.metadata);
      expect(result.data.episodes).toEqual(
        oldResult.data.episodes.map((episode) => ({
          ...(episode as object),
          id: expect.any(String),
        })),
      );
    });

    it('creates the episode rows batchCreateEpisodesAction used to create from the client, built the same way', async () => {
      const old = fixture('season-outline');
      expect(old.writes).toEqual([]);

      const { processSeasonOutline } = await import(
        '../handlers/season-outline'
      );
      const db = recordingClient(parityResponder());

      await processSeasonOutline(SEASON_OUTLINE_PAYLOAD, db.client);

      const writes = db.writes();
      expect(writes.map((w) => `${w.table}:${w.op}`)).toEqual([
        'episodes:insert',
      ]);

      const rows = SEASON_OUTLINE_ORCHESTRATOR_RESULT.episodes.map(
        (outline, index) =>
          episodeRowFromOutline(outline, {
            projectId: IDS.projectId,
            seasonId: IDS.seasonId,
            number: SEASON_OUTLINE_PAYLOAD.startingNumber + index,
          }),
      );
      expect(writes[0]!.payload).toEqual(rows);
      expect(rows[0]).toMatchObject({
        number: 3,
        slug: 'episode-3-the-first-light',
        status: 'draft',
        story_data: expect.objectContaining({ generatedFromBatch: true }),
        version: 1,
      });
    });
  });

  describe('season analysis', () => {
    it('renders season-generation with the same variables and returns the same analysis', async () => {
      const old = fixture('season-analysis');
      const { processSeasonAnalysis } = await import(
        '../handlers/season-analysis'
      );
      const db = recordingClient(parityResponder());

      const result = await processSeasonAnalysis(
        SEASON_ANALYSIS_PAYLOAD,
        db.client,
      );

      // The same prompt and variables; since #555 the executor is also told
      // whose job it is (through generateWithLambda), which the old handler
      // recorded here did not pass
      expect(json(seen.season_analysis)).toMatchObject(
        old.executorInput as object,
      );
      expect(seen.season_analysis).toMatchObject({
        accountId: IDS.accountId,
        userId: IDS.userId,
        operationName: 'season-analysis',
      });
      expect(json(result)).toEqual(old.result);
    });

    it('stores the analysis on the project, which the old handler did not', async () => {
      const old = fixture('season-analysis');
      expect(old.writes).toEqual([]);

      const { processSeasonAnalysis } = await import(
        '../handlers/season-analysis'
      );
      const db = recordingClient(parityResponder());

      await processSeasonAnalysis(SEASON_ANALYSIS_PAYLOAD, db.client);

      expect(db.writes()).toEqual([
        expect.objectContaining({
          table: 'projects',
          op: 'update',
          payload: {
            metadata: {
              ...(TABLES.projects as { metadata: object }).metadata,
              latestSeasonAnalysis: {
                generatedAt: NOW.toISOString(),
                mode: 'server',
                analysis: SEASON_ANALYSIS_RESULT,
              },
            },
          },
          filters: [{ method: 'eq', args: ['id', IDS.projectId] }],
        }),
      ]);
    });
  });
});
