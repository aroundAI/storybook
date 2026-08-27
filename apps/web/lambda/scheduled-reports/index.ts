/**
 * Scheduled Reports Lambda Handler
 *
 * Simple wrapper that calls the scheduled reports API endpoint, which
 * generates and emails any reports whose next_run_at has passed.
 * Triggered by AWS EventBridge on an hourly schedule (FILM-1503).
 */

interface ScheduledReportsResult {
  success: boolean;
  processed?: number;
  errors?: number;
  error?: string;
}

/**
 * Lambda handler for the scheduled reports cron job
 */
export async function handler(): Promise<ScheduledReportsResult> {
  const apiUrl = process.env.API_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!apiUrl) {
    console.error('API_URL environment variable not configured');
    return { success: false, error: 'API_URL not configured' };
  }

  if (!cronSecret) {
    console.error('CRON_SECRET environment variable not configured');
    return { success: false, error: 'CRON_SECRET not configured' };
  }

  try {
    const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;

    const response = await fetch(`${baseUrl}/api/reports/scheduled`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `Scheduled reports endpoint returned ${response.status}: ${text}`,
      );
      return {
        success: false,
        error: `HTTP ${response.status}`,
      };
    }

    const result = (await response.json()) as ScheduledReportsResult;
    console.log('Scheduled reports run completed:', JSON.stringify(result));

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Scheduled reports run failed:', message);
    return { success: false, error: message };
  }
}
