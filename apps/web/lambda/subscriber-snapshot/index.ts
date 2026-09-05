/**
 * Subscriber Snapshot Lambda Handler (FILM-1607)
 *
 * Captures one absolute subscriber anchor per connection per day.
 * Triggered by AWS EventBridge at 02:00 UTC.
 *
 * Thin by design: the work lives behind the API route, so this only carries
 * the bearer token. FILM-1503 records that a route without a Cron entry never
 * runs in deployed infra — this pairs the two.
 */

interface SubscriberSnapshotResult {
  success: boolean;
  attempted?: number;
  skippedByDesign?: number;
  written?: number;
  shortfall?: number;
  error?: string;
}

export async function handler(): Promise<SubscriberSnapshotResult> {
  const apiUrl = process.env.API_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!apiUrl || !cronSecret) {
    return { success: false, error: 'API_URL or CRON_SECRET not configured' };
  }

  const baseUrl = apiUrl.replace(/\/$/, '');

  try {
    const response = await fetch(`${baseUrl}/api/cron/subscriber-snapshot`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cronSecret}` },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Subscriber snapshot returned HTTP ${response.status}`,
      };
    }

    return (await response.json()) as SubscriberSnapshotResult;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
