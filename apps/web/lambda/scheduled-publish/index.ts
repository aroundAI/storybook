/**
 * Scheduled Publish Lambda Handler
 *
 * Processes scheduled video publishes that are due.
 * Triggered by AWS EventBridge every 5 minutes.
 */

interface ScheduledPublishResult {
  success: boolean;
  processed?: number;
  published?: number;
  failed?: number;
  error?: string;
}

/**
 * Lambda handler for scheduled publish cron job
 */
export async function handler(): Promise<ScheduledPublishResult> {
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

    const response = await fetch(`${baseUrl}/api/cron/publish-scheduled`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Scheduled publish API returned ${response.status}: ${errorText}`,
      );
      return {
        success: false,
        error: `API returned ${response.status}`,
      };
    }

    const result = (await response.json()) as ScheduledPublishResult;

    console.log('Scheduled publish completed:', JSON.stringify(result));

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Scheduled publish failed:', errorMessage);

    return {
      success: false,
      error: errorMessage,
    };
  }
}
