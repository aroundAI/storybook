import { NextRequest } from 'next/server';

import { accountIdFromUnverifiedState } from '~/lib/platforms/connect-failure';
import {
  catchConnectFailures,
  failConnect,
} from '~/lib/platforms/fail-connect';

/**
 * LinkedIn is retired (FILM-717, owner 2026-10-02). A consent screen opened
 * before the release can still send someone here, so the route answers with
 * the retirement instead of a 404. It exchanges no code, stores no row and
 * leaves the OAuth state to expire.
 */
async function handleCallback(request: NextRequest) {
  return failConnect({
    request,
    platform: 'linkedin',
    accountId: accountIdFromUnverifiedState(
      request.nextUrl.searchParams.get('state'),
    ),
    code: 'platform_retired',
    branch: 'platform_retired',
  });
}

export const GET = catchConnectFailures('linkedin', handleCallback);
