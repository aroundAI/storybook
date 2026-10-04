import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Brief, shotsStage } from '@kit/generation';

import {
  episodeFixture,
  fixtureEpisodeContext,
  shotsPartOutputs,
} from '../../../generation/src/testing/part-d';
import type { McpToolDefinition } from '../../src/registry';
import { createGenerationTools } from '../../src/server/tools/generation';
import { createFakeRunApi, partsResponders } from '../helpers/fake-runs';
import { createFakeClient, fakeContext } from '../helpers/fake-supabase';

/**
 * KB-178 over MCP (FILM-1908): an external shots run gives each scene's
 * brief the Reel Scout part the agent submitted first, so a scene the scout
 * flagged carries its priority note, in the instructions the agent reads
 * and in the context, and an unflagged scene does not. The real shots
 * stage runs on FILM-1901 part D's fixture episode.
 */
const EPISODE_ID = episodeFixture.ids.episodeId;

function setup() {
  const runs = createFakeRunApi({ shots: shotsStage });
  const parts = partsResponders(runs);
  const fake = createFakeClient({
    // the fixture's row as the episodes table holds it: with its project id
    episodes: [
      { ...episodeFixture.episode, project_id: episodeFixture.ids.projectId },
    ],
    shots: episodeFixture.existingShots,
    ...parts.responders,
  });
  const tools = createGenerationTools(() => ({
    runs,
    episodeContext: () => fixtureEpisodeContext,
  }));
  const call = (name: string, input: Record<string, unknown>) =>
    (tools.find((tool) => tool.name === name) as McpToolDefinition).handler(
      input as never,
      fakeContext(fake.client),
    );

  return { call };
}

describe('the Reel Scout note in an external shots run (KB-178, FILM-1908)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a flagged scene's brief carries the note once the reel_scout part is accepted; an unflagged one does not", async () => {
    const { call } = setup();
    const outputs = shotsPartOutputs();
    // reelNoteFor's wording (KB-178): asserted as text, not imported
    const note = 'PRIORITY: This scene is a Reel candidate';

    const started = (await call('start_generation', {
      stage: 'shots',
      episodeId: EPISODE_ID,
    })) as {
      structuredContent: { run: { runId: string }; brief: Brief };
    };
    const runId = started.structuredContent.run.runId;

    // Before the scout part, no scene can know it was flagged
    expect(started.structuredContent.brief.part.key).toBe('reel_scout');
    const early = (await call('get_brief', {
      runId,
      partKey: 'scene:1',
    })) as { structuredContent: { brief: Brief } };
    expect(early.structuredContent.brief.instructions).not.toContain(
      'Reel candidate',
    );

    const scouted = (await call('submit_generation', {
      runId,
      partKey: 'reel_scout',
      output: outputs.get('reel_scout'),
    })) as {
      structuredContent: { status: string; nextBrief: Brief };
    };

    expect(scouted.structuredContent.status).toBe('accepted');
    // The next brief is scene 1, which the scout flagged
    expect(scouted.structuredContent.nextBrief.part.key).toBe('scene:1');
    expect(scouted.structuredContent.nextBrief.instructions).toContain(note);
    expect(scouted.structuredContent.nextBrief.context.reelNote).toContain(
      note,
    );

    const flagged = (await call('get_brief', {
      runId,
      partKey: 'scene:1',
    })) as { structuredContent: { brief: Brief } };
    expect(flagged.structuredContent.brief.instructions).toContain(note);

    const unflagged = (await call('get_brief', {
      runId,
      partKey: 'scene:2',
    })) as { structuredContent: { brief: Brief } };
    expect(unflagged.structuredContent.brief.instructions).not.toContain(
      'Reel candidate',
    );
    expect(unflagged.structuredContent.brief.context.reelNote).toBe('');
  });
});
