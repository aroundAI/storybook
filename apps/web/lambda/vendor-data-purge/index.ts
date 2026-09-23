/**
 * Vendor Data Purge Lambda Handler (KB-20 item 3 / KB-22 part B)
 *
 * Deletes queued connections' vendor data: YouTube statistics within 7 days
 * of an in-app disconnect, and everything a deleted account's connections
 * brought in. Triggered hourly by AWS EventBridge.
 *
 * Thin by design, like subscriber-snapshot: the work lives behind the API
 * route, so this only carries the bearer token.
 */

interface VendorDataPurgeResult {
  success: boolean;
  processed?: number;
  completed?: number;
  failed?: number;
  overdue?: number;
  error?: string;
}

export async function handler(): Promise<VendorDataPurgeResult> {
  const apiUrl = process.env.API_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!apiUrl || !cronSecret) {
    return { success: false, error: 'API_URL or CRON_SECRET not configured' };
  }

  const baseUrl = apiUrl.replace(/\/$/, '');

  try {
    const response = await fetch(`${baseUrl}/api/cron/vendor-data-purge`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cronSecret}` },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Vendor data purge returned HTTP ${response.status}`,
      };
    }

    return (await response.json()) as VendorDataPurgeResult;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
