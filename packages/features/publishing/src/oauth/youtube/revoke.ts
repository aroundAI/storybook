import 'server-only';

import { type RevokeOutcome, requestRevocation } from '../revoke-request';
import { YOUTUBE_OAUTH_CONFIG } from './config';

/**
 * Revokes the grant at Google. Revoking the access token revokes the refresh
 * token issued with it.
 */
export function revokeYouTubeAccess(
  accessToken: string,
): Promise<RevokeOutcome> {
  return requestRevocation(
    `${YOUTUBE_OAUTH_CONFIG.revokeUrl}?token=${encodeURIComponent(accessToken)}`,
    { method: 'POST' },
  );
}
