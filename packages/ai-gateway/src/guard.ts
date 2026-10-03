/**
 * What every model call checks first (FILM-1902 criterion 6): the run is
 * server mode, and open. The lease is renewed in the same round trip, so
 * the answer is the database's, not a stale handle's; a run cancelled from
 * the web banner or expired by the cron refuses the next call.
 */
import type { RunHandle } from '@kit/generation';

import { GatewayError } from './errors';

export async function assertServerRunOpen(run: RunHandle): Promise<void> {
  if (run.mode !== 'server') {
    throw new GatewayError(
      'LLM_FORBIDDEN_EXTERNAL_RUN',
      `Run ${run.id} is ${run.mode}: a model is never called for external work`,
      run.id,
    );
  }

  await run.renewLease();

  if (!run.isOpen()) {
    throw new GatewayError(
      'LLM_FORBIDDEN_EXTERNAL_RUN',
      `Run ${run.id} is ${run.status}${run.leaseExpiresAt && new Date(run.leaseExpiresAt) <= new Date() ? ' with its lease expired' : ''}: no model call for a run that is not open`,
      run.id,
    );
  }
}
