/**
 * Token Refresh Helper
 *
 * Handles OAuth token refresh for all supported platforms
 */

export interface TokenRefreshResult {
    accessToken: string;
    refreshToken?: string;
    expiresAt: string;
}

/**
 * Refresh OAuth token for a platform
 */
export async function refreshOAuthToken(
    platform: string,
    refreshToken: string,
): Promise<TokenRefreshResult> {
    switch (platform) {
        case 'youtube':
            return refreshYouTubeToken(refreshToken);
        case 'tiktok':
            return refreshTikTokToken(refreshToken);
        case 'instagram':
        case 'facebook':
            // Meta uses long-lived tokens that are refreshed via exchange
            throw new Error('Meta token refresh requires access token, not refresh token');
        case 'linkedin':
            return refreshLinkedInToken(refreshToken);
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
}

async function refreshYouTubeToken(refreshToken: string): Promise<TokenRefreshResult> {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('YouTube OAuth credentials not configured');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`YouTube token refresh failed: ${error}`);
    }

    const data = await response.json();
    const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresAt: expiresAt.toISOString(),
    };
}

async function refreshTikTokToken(refreshToken: string): Promise<TokenRefreshResult> {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

    if (!clientKey || !clientSecret) {
        throw new Error('TikTok OAuth credentials not configured');
    }

    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_key: clientKey,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`TikTok token refresh failed: ${error}`);
    }

    const data = await response.json();
    const expiresAt = new Date(Date.now() + (data.expires_in || 86400) * 1000);

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: expiresAt.toISOString(),
    };
}

async function refreshLinkedInToken(refreshToken: string): Promise<TokenRefreshResult> {
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('LinkedIn OAuth credentials not configured');
    }

    const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`LinkedIn token refresh failed: ${error}`);
    }

    const data = await response.json();
    const expiresAt = new Date(Date.now() + (data.expires_in || 5184000) * 1000);

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresAt: expiresAt.toISOString(),
    };
}
