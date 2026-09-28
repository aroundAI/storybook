/**
 * Channel Reach Lambda Handler (migration 016)
 *
 * Records each Instagram channel's unique reach per window, nightly.
 * Triggered by AWS EventBridge at 02:30 UTC.
 *
 * Thin by design, like subscriber-snapshot: the work lives behind the API
 * route, so this only carries the bearer token.
 */

interface ChannelReachResult {
  success: boolean;
  channels?: number;
  rowsWritten?: number;
  failed?: number;
  error?: string;
}

export async function handler(): Promise<ChannelReachResult> {
  const apiUrl = process.env.API_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!apiUrl || !cronSecret) {
    return { success: false, error: 'API_URL or CRON_SECRET not configured' };
  }

  const baseUrl = apiUrl.replace(/\/$/, '');

  try {
    const response = await fetch(`${baseUrl}/api/cron/channel-reach`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cronSecret}` },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Channel reach returned HTTP ${response.status}`,
      };
    }

    return (await response.json()) as ChannelReachResult;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
