import { describe, expect, it } from 'vitest';

import { RunError } from '@kit/generation';
import { ActionRefusal } from '@kit/next/action-result';

import {
  SERVER_GENERATION_OFF_REFUSAL,
  STAGE_IN_PROGRESS_REFUSAL,
} from '../src/jobs';
import { refuseRunError } from '../src/refuse-run-error';

/**
 * KB-182: a Generate action that opens its run behind `returnRefusals`
 * returns the gateway's words, not a thrown message that production
 * replaces with a generic sentence.
 */
describe('refuseRunError', () => {
  it.each([
    ['SERVER_GENERATION_DISABLED', SERVER_GENERATION_OFF_REFUSAL],
    ['RUN_IN_PROGRESS', STAGE_IN_PROGRESS_REFUSAL],
  ] as const)('words a %s refusal for the page', async (code, words) => {
    const refusal = await refuseRunError(new RunError(code, 'internal')).catch(
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(ActionRefusal);
    expect((refusal as ActionRefusal).message).toBe(words);
  });

  it('rethrows anything else as it was', async () => {
    const crash = new Error('database down');

    await expect(refuseRunError(crash)).rejects.toBe(crash);
  });
});
