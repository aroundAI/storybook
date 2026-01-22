/**
 * URL validation for SSRF protection
 * Only allows URLs from trusted storage domains
 */

// Get allowed domains from environment or use defaults
const getAllowedDomains = (): string[] => {
    const envDomains = process.env.ALLOWED_STORAGE_DOMAINS;
    if (envDomains) {
        return envDomains.split(',').map((d) => d.trim());
    }

    // Default allowed domains
    return [
        // R2 storage
        'r2.cloudflarestorage.com',
        // Supabase storage (format: <project-ref>.supabase.co)
        'supabase.co',
        // CloudFront
        'cloudfront.net',
        // AWS S3
        's3.amazonaws.com',
    ];
};

// Private IP ranges to block
const PRIVATE_IP_PATTERNS = [
    /^127\./, // Loopback
    /^10\./, // Class A private
    /^172\.(1[6-9]|2\d|3[01])\./, // Class B private
    /^192\.168\./, // Class C private
    /^169\.254\./, // Link-local
    /^0\./, // Current network
    /^localhost$/i,
];

/**
 * Check if a URL is from an allowed domain
 */
export function isAllowedUrl(url: string): boolean {
    if (!url) return false;

    try {
        const parsed = new URL(url);
        const allowedDomains = getAllowedDomains();

        // Block private IPs
        if (PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(parsed.hostname))) {
            return false;
        }

        // Block non-HTTPS (except localhost for dev)
        if (
            parsed.protocol !== 'https:' &&
            process.env.NODE_ENV !== 'development'
        ) {
            return false;
        }

        // Check against allowed domains
        return allowedDomains.some(
            (domain) =>
                parsed.hostname === domain || parsed.hostname.endsWith('.' + domain),
        );
    } catch {
        return false;
    }
}

/**
 * Validate a content URL, returning null if invalid
 * Use this for optional URLs (like thumbnails)
 */
export function validateContentUrl(
    url: string | null | undefined,
): string | null {
    if (!url) return null;

    if (!isAllowedUrl(url)) {
        console.warn('[SECURITY] Blocked potentially unsafe URL:', url);
        return null; // Return null to gracefully degrade
    }

    return url;
}

/**
 * Assert a URL is safe, throwing if invalid
 * Use this for required URLs (like video URLs)
 */
export function assertSafeUrl(url: string, context: string): void {
    if (!isAllowedUrl(url)) {
        throw new Error(`URL not from allowed domain [${context}]`);
    }
}
