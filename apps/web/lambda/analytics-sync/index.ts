/**
 * Analytics Sync Lambda Handler
 *
 * Simple wrapper that calls the analytics sync API endpoint.
 * Triggered by AWS EventBridge on an hourly schedule.
 */

/**
 * Sync job result from the API endpoint.
 * This interface mirrors SyncJobResult from @kit/content-analytics/server/types
 * but is defined locally since Lambda handlers cannot import from workspace packages.
 */
interface SyncJobResult {
  success: boolean;
  totalProcessed?: number;
  successful?: number;
  failed?: number;
  skipped?: number;
  notAuthorised?: number;
  byPlatform?: Record<
    string,
    { processed: number; successful: number; failed: number }
  >;
  durationMs?: number;
  error?: string;
}

/**
 * Lambda handler for analytics sync cron job
 */
export async function handler(): Promise<SyncJobResult> {
  const apiUrl = process.env.API_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!apiUrl) {
    console.error('API_URL environment variable not configured');
    return {
      success: false,
      error: 'API_URL not configured',
    };
  }

  if (!cronSecret) {
    console.error('CRON_SECRET environment variable not configured');
    return {
      success: false,
      error: 'CRON_SECRET not configured',
    };
  }

  try {
    // Ensure URL doesn't have trailing slash
    const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;

    const response = await fetch(`${baseUrl}/api/analytics/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Analytics sync API returned ${response.status}: ${errorText}`,
      );
      return {
        success: false,
        error: `API returned ${response.status}`,
      };
    }

    const result = (await response.json()) as SyncJobResult;

    console.log('Analytics sync completed:', JSON.stringify(result));

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Analytics sync failed:', errorMessage);

    return {
      success: false,
      error: errorMessage,
    };
  }
}
