/**
 * MCP Guard Check Lambda Handler (FILM-1911)
 *
 * Hourly: asks the web app whether any model-usage row belongs to an
 * external (MCP) run, which would mean the FILM-1903 lock failed. The route
 * logs and reports the finding; this only carries the bearer token, like
 * expire-generation-runs, and then fails, because McpGuardFailedAlarm
 * (sst.config.ts) is an alarm on this function's errors. A check that could
 * not run fails too: silence must mean the check passed.
 */

interface ExternalRunModelCallsResult {
  success: boolean;
  violations: number;
}

export async function handler(): Promise<ExternalRunModelCallsResult> {
  const apiUrl = process.env.API_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!apiUrl || !cronSecret) {
    throw new Error(
      'MCP guard check could not run: API_URL or CRON_SECRET not configured',
    );
  }

  const baseUrl = apiUrl.replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/api/cron/external-run-model-calls`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cronSecret}` },
  });

  if (!response.ok) {
    throw new Error(`MCP guard check could not run: HTTP ${response.status}`);
  }

  const result = (await response.json()) as ExternalRunModelCallsResult;

  if (result.violations > 0) {
    throw new Error(
      `MCP guard failed: ${result.violations} model-usage rows belong to external runs`,
    );
  }

  return result;
}
