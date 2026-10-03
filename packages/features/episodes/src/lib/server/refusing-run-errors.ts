import 'server-only';

import { ActionRefusal } from '@kit/next/action-result';

/**
 * `.catch()` handler for a run opened by a studio Generate button
 * (FILM-1910): a refusal the user can act on (server generation turned
 * off, the stage already held) becomes an `ActionRefusal` with the
 * gateway's words. Only for actions wrapped in `returnRefusals`, which
 * return it as a value; anything else is rethrown as it was.
 */
export async function refuseRunError(error: unknown): Promise<never> {
  const { runRefusalMessage } = await import('@kit/ai-gateway');
  const refusal = runRefusalMessage(error);

  if (refusal) throw new ActionRefusal(refusal);

  throw error;
}
