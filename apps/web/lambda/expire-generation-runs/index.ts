/**
 * Generation Run Expiry Lambda Handler (FILM-1903)
 *
 * Marks generation runs past their lease expired, so a forgotten external
 * conversation never holds an episode's stage. Triggered hourly by AWS
 * EventBridge.
 *
 * Thin by design, like vendor-data-purge: the work lives behind the API
 * route, so this only carries the bearer token.
 */

interface ExpireGenerationRunsResult {
  success: boolean;
  expired?: number;
  error?: string;
}

export async function handler(): Promise<ExpireGenerationRunsResult> {
  const apiUrl = process.env.API_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!apiUrl || !cronSecret) {
    return { success: false, error: 'API_URL or CRON_SECRET not configured' };
  }

  const baseUrl = apiUrl.replace(/\/$/, '');

  try {
    const response = await fetch(`${baseUrl}/api/cron/expire-generation-runs`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cronSecret}` },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Generation run expiry returned HTTP ${response.status}`,
      };
    }

    return (await response.json()) as ExpireGenerationRunsResult;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
