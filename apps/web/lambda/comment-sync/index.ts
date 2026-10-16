/**
 * Comment Sync Lambda Handler (FILM-1733)
 *
 * Reads the audience comments on the team's published videos, deletes
 * YouTube comments not refreshed for 30 days, and opens the labelling runs.
 * Triggered hourly by AWS EventBridge.
 *
 * Thin by design, like vendor-data-purge: the work lives behind the API
 * route, so this only carries the bearer token.
 */

interface CommentSyncResult {
  success: boolean;
  expired?: number;
  due?: number;
  read?: number;
  stored?: number;
  removed?: number;
  failed?: number;
  notAuthorised?: number;
  projectsToLabel?: number;
  error?: string;
}

export async function handler(): Promise<CommentSyncResult> {
  const apiUrl = process.env.API_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!apiUrl || !cronSecret) {
    return { success: false, error: 'API_URL or CRON_SECRET not configured' };
  }

  const baseUrl = apiUrl.replace(/\/$/, '');

  try {
    const response = await fetch(`${baseUrl}/api/cron/comment-sync`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cronSecret}` },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Comment sync returned HTTP ${response.status}`,
      };
    }

    return (await response.json()) as CommentSyncResult;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
