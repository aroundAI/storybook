import 'server-only';

import { unstable_rethrow } from 'next/navigation';

import { getLogger } from '@kit/shared/logger';

import { ActionRefusal, type ActionResult } from '../lib/action-result';

/**
 * Wraps a mutation action so every outcome is a value the client can read in
 * a production build (see `ActionResult`).
 *
 * Wraps the finished `enhanceAction`, so the schema still types the handler
 * and a validation failure is caught here too. An `ActionRefusal` is
 * returned with its own message. Anything else — a database or ClickHouse
 * failure — is logged with its detail and returned as a generic message
 * naming what did not happen. Next's own control flow (a redirect to sign
 * in, a not-found) is rethrown untouched.
 */
export function withRefusals<Input, T>(
  what: string,
  action: (input: Input) => Promise<T>,
): (input: Input) => Promise<ActionResult<T>> {
  return async (input) => {
    try {
      return { ok: true, data: await action(input) };
    } catch (error) {
      unstable_rethrow(error);

      if (error instanceof ActionRefusal) {
        return { ok: false, error: error.message };
      }

      const logger = await getLogger();
      logger.error({ error, what }, `Could not ${what}`);

      return {
        ok: false,
        error: `Could not ${what}. Try again; if it keeps failing, reload the page.`,
      };
    }
  };
}
