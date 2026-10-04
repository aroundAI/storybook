import { ActionRefusal } from '@kit/next/action-result';

import { runRefusalMessage } from './jobs';

/**
 * `.catch()` handler for a run opened by a web Generate action (FILM-1910,
 * KB-182): a refusal the user can act on (server generation turned off, the
 * stage already held, no model key) becomes an `ActionRefusal` with the
 * gateway's words. Only for actions wrapped in `returnRefusals`, which
 * return it as a value; anything else is rethrown as it was.
 */
export async function refuseRunError(error: unknown): Promise<never> {
  const refusal = runRefusalMessage(error);

  if (refusal) throw new ActionRefusal(refusal);

  throw error;
}
