/**
 * Token Refresh Lambda Handler
 *
 * Refreshes OAuth tokens that are about to expire.
 * Triggered by AWS EventBridge every 30 minutes.
 */

interface TokenRefreshResult {
    success: boolean;
    refreshed?: number;
    failed?: number;
    error?: string;
}

/**
 * Lambda handler for token refresh cron job
 */
export async function handler(): Promise<TokenRefreshResult> {
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

        const response = await fetch(`${baseUrl}/api/cron/token-refresh`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${cronSecret}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(
                `Token refresh API returned ${response.status}: ${errorText}`,
            );
            return {
                success: false,
                error: `API returned ${response.status}`,
            };
        }

        const result = (await response.json()) as TokenRefreshResult;

        console.log('Token refresh completed:', JSON.stringify(result));

        return result;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Token refresh failed:', errorMessage);

        return {
            success: false,
            error: errorMessage,
        };
    }
}
