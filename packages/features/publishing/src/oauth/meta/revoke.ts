import 'server-only';

import {
  type RevokeOutcome,
  type RevokeTokens,
  requestRevocation,
} from '../revoke-request';
import { META_OAUTH_CONFIG } from './config';

/**
 * Removes every permission the Facebook login granted the app. An Instagram
 * account is reached through a Page on that same login, so this revokes both
 * — which is why `disconnect_platform_connection` disconnects the linked row
 * too.
 */
export function revokeMetaAccess({
  accessToken,
}: RevokeTokens): Promise<RevokeOutcome> {
  return requestRevocation(
    `${META_OAUTH_CONFIG.graphUrl}/me/permissions?access_token=${encodeURIComponent(accessToken)}`,
    { method: 'DELETE' },
  );
}
