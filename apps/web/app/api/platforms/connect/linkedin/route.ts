import { NextRequest } from 'next/server';

import { failConnect } from '~/lib/platforms/fail-connect';

/**
 * LinkedIn is retired (FILM-717, owner 2026-10-02). The route stays so that
 * an old connect link lands on Settings → Platforms with a sentence saying
 * so, rather than a 404. Nothing is stored and LinkedIn is never called.
 */
export async function GET(request: NextRequest) {
  return failConnect({
    request,
    platform: 'linkedin',
    code: 'platform_retired',
    branch: 'platform_retired',
  });
}
