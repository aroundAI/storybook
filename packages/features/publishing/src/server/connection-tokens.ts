import 'server-only';

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
  | { accessToken?: never; error: string }
> {
  const result = await ensureValidToken(connectionId);

  if (!result.valid || !result.accessToken) {
    return {
      error: result.error ?? 'Token validation failed',
    };
  }

  return { accessToken: result.accessToken };
}
