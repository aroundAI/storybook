import { describe, expect, it } from 'vitest';

import { ALL_STAGES } from '@kit/generation';

import { STAGE_WRITERS } from '../src/agent/stage-writers';

/**
 * KB-184: a stage flagged `orchestrated` is refused by the gateway's server
 * writer unless a stage writer is installed for it, so every one of them
 * has one here, once, and nothing else does.
 */
describe('STAGE_WRITERS', () => {
  it('holds one writer per orchestrated stage, and only those', () => {
    const orchestrated = ALL_STAGES.filter((stage) => stage.orchestrated)
      .map((stage) => stage.key)
      .sort();
    const written = STAGE_WRITERS.map((writer) => writer.stage).sort();

    expect(orchestrated.length).toBeGreaterThan(0);
    expect(written).toEqual(orchestrated);
    expect(new Set(written).size).toBe(written.length);
  });
});
