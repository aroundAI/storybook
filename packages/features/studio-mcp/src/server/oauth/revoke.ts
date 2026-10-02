import { hashToken } from '../token';
import { OAuthError } from './errors';
import type { OAuthStore } from './store';

/**
 * `POST /oauth/revoke` (RFC 7009). An access token is revoked alone; a
 * refresh token takes its whole connection with it, since the grant it
 * stands for is what the client is giving up. An unknown token is not an
 * error: the client wanted it gone, and it is.
 */
export async function handleRevokeRequest(
  params: URLSearchParams,
  deps: { store: OAuthStore; now?: () => Date },
): Promise<void> {
  const token = params.get('token');

  if (!token) throw new OAuthError('invalid_request', 'token is required.');

  const now = (deps.now ?? (() => new Date()))();
  const record = await deps.store.getToken(hashToken(token));

  if (!record || record.revokedAt) return;

  if (record.kind === 'refresh') {
    await deps.store.revokeConnection(record.connectionId, now);

    return;
  }

  await deps.store.revokeToken(record.tokenHash, now);
}
