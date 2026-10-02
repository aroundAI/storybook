/**
 * Captures what the OLD story, ideation, season-outline and season-analysis
 * handlers do with the inputs in helpers/stage-parity.ts: the executor input
 * each one builds and every write it issues. Run once before the handlers
 * are rewritten (FILM-1901 part B); the parity tests read the result.
 *
 *   pnpm --filter web exec vitest run capture-stage-parity
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, it, vi } from 'vitest';

import { recordingClient } from '@kit/generation/testing';

import {
  CANON_EXTRACTION,
  EPISODE_CONTEXT,
  IDEATION_ORCHESTRATOR_RESULT,
  IDEATION_PAYLOAD,
  NOW,
  SEASON_ANALYSIS_PAYLOAD,
  SEASON_ANALYSIS_RESULT,
  SEASON_OUTLINE_ORCHESTRATOR_RESULT,
  SEASON_OUTLINE_PAYLOAD,
  STORY_ORCHESTRATOR_RESULT,
  STORY_PAYLOAD,
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

const FIXTURES = path.resolve(__dirname, 'fixtures');

function save(name: string, data: unknown) {
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(
    path.join(FIXTURES, `${name}-parity.json`),
    JSON.stringify(data, null, 2) + '\n',
  );
}

describe('capture the old handlers (FILM-1901 part B)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('story', async () => {
    const { processStoryGeneration } = await import(
      '../handlers/story-generation'
    );
    const db = recordingClient(parityResponder());
    const result = await processStoryGeneration(STORY_PAYLOAD, db.client);

    save('story', {
      executorInput: seen.story,
      canonExtractionInput: seen['canon-extraction'],
      writes: db.writes(),
      result,
    });
  });

  it('ideation', async () => {
    const { processStoryIdeation } = await import('../handlers/story-ideation');
    const db = recordingClient(parityResponder());
    const result = await processStoryIdeation(IDEATION_PAYLOAD, db.client);

    save('ideation', {
      executorInput: seen.ideation,
      writes: db.writes(),
      result,
    });
  });

  it('season outline', async () => {
    const { processSeasonOutline } = await import('../handlers/season-outline');
    const db = recordingClient(parityResponder());
    const result = await processSeasonOutline(
      SEASON_OUTLINE_PAYLOAD,
      db.client,
    );

    save('season-outline', {
      executorInput: seen.season_outline,
      writes: db.writes(),
      result,
    });
  });

  it('season analysis', async () => {
    const { processSeasonAnalysis } = await import(
      '../handlers/season-analysis'
    );
    const db = recordingClient(parityResponder());
    const result = await processSeasonAnalysis(
      SEASON_ANALYSIS_PAYLOAD,
      db.client,
    );

    save('season-analysis', {
      executorInput: seen.season_analysis,
      writes: db.writes(),
      result,
    });
  });
});
