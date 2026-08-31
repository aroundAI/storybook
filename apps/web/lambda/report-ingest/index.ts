/**
 * YouTube Report Ingest Lambda Handler
 *
 * Simple wrapper that calls the reports-ingest API endpoint, which pulls
 * YouTube Reporting API bulk report CSVs into ClickHouse (FILM-1504).
 * Triggered by AWS EventBridge every 6 hours.
 */

interface ReportIngestResult {
  success: boolean;
  connectionsProcessed?: number;
  reportsIngested?: number;
  rowsMatched?: number;
  rowsUnmatched?: number;
  durationMs?: number;
  error?: string;
}

/**
 * Lambda handler for the report ingest cron job
 */
export async function handler(): Promise<ReportIngestResult> {
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

    const response = await fetch(`${baseUrl}/api/analytics/reports-ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `Report ingest endpoint returned ${response.status}: ${text}`,
      );
      return { success: false, error: `HTTP ${response.status}` };
    }

    const result = (await response.json()) as ReportIngestResult;
    console.log('Report ingest run completed:', JSON.stringify(result));

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Report ingest run failed:', message);
    return { success: false, error: message };
  }
}
