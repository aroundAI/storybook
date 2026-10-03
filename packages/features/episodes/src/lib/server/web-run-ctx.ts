import 'server-only';

import type { RunCtx } from '@kit/generation';

/**
 * The run context a web server action opens a job run with: the caller's
 * client and identity, plus the past-performance reader (FILM-1912) on that
 * same client. `openRun` reads it only for ideation, story and shots, and
 * only when the team turned the setting on, so other jobs read nothing.
 */
export async function webRunCtx(
  client: RunCtx['client'],
  accountId: string,
  userId: string,
): Promise<RunCtx> {
  const { createPerformanceReader } = await import(
    '@kit/content-analytics/server/performance-reader'
  );

  return {
    client,
    accountId,
    userId,
    performance: createPerformanceReader(client),
  };
}
