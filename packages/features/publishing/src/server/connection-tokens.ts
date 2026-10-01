import 'server-only';

import type { TokenErrorCode } from '../lib/token-errors';
import { ensureValidToken } from '../lib/token-refresh';

/*
 * Returns a decrypted access token for any connection id, through the
 * service-role client, so it must never be a server action (KB-58). Callers
 * are actions that have already checked the caller may publish.
 */

/**
 * Get a decrypted access token for a connection
 * Used by publish actions
 */
export async function getAccessToken(
  connectionId: string,
): Promise<
  | { accessToken: string; error?: never }
  | { accessToken?: never; error: TokenErrorCode }
> {
  const result = await ensureValidToken(connectionId);

  if (!result.valid || !result.accessToken) {
    // A code, for `TokenRefusal` to word for the page (KB-157)
    return { error: result.error ?? 'NO_ACCESS_TOKEN' };
  }

  return { accessToken: result.accessToken };
}
