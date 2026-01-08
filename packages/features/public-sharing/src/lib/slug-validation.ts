/**
 * Slug validation utilities for public sharing.
 * Prevents reserved words and inappropriate content in public URLs.
 */

// Reserved slugs that cannot be used
const RESERVED_SLUGS = new Set([
    // System routes
    'home',
    'admin',
    'api',
    'auth',
    'login',
    'logout',
    'signup',
    'signin',
    'register',
    'settings',
    'profile',
    'account',
    'accounts',
    'dashboard',
    'app',
    'apps',
    'help',
    'support',
    'docs',
    'documentation',
    'blog',
    'news',
    'about',
    'contact',
    'terms',
    'privacy',
    'legal',
    'sitemap',
    'robots',
    'static',
    'assets',
    'public',
    'private',
    'internal',
    'system',
    'root',
    'null',
    'undefined',
    'true',
    'false',
    // Brand protection
    'storybook',
    'storybookAI',
    'official',
    'verified',
    'team',
    'teams',
    'org',
    'organization',
    'enterprise',
    // Common abuse patterns
    'test',
    'testing',
    'demo',
    'example',
    'sample',
    'temp',
    'temporary',
    'delete',
    'deleted',
    'removed',
    'banned',
    'suspended',
]);

// Profanity list (simplified - in production, use a proper library)
const BLOCKED_WORDS: Set<string> = new Set([
    // Add blocked words here
    // This is a minimal set - use a proper profanity filter in production
]);

export interface SlugValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * Validate a slug for public URLs.
 */
export function validateSlug(slug: string): SlugValidationResult {
    // Check minimum length
    if (slug.length < 3) {
        return {
            valid: false,
            error: 'Slug must be at least 3 characters long',
        };
    }

    // Check maximum length
    if (slug.length > 50) {
        return {
            valid: false,
            error: 'Slug must be at most 50 characters long',
        };
    }

    // Check format (lowercase letters, numbers, hyphens only)
    if (!/^[a-z0-9-]+$/.test(slug)) {
        return {
            valid: false,
            error: 'Slug can only contain lowercase letters, numbers, and hyphens',
        };
    }

    // Check for leading/trailing hyphens
    if (slug.startsWith('-') || slug.endsWith('-')) {
        return {
            valid: false,
            error: 'Slug cannot start or end with a hyphen',
        };
    }

    // Check for consecutive hyphens
    if (slug.includes('--')) {
        return {
            valid: false,
            error: 'Slug cannot contain consecutive hyphens',
        };
    }

    // Check reserved words
    if (RESERVED_SLUGS.has(slug.toLowerCase())) {
        return {
            valid: false,
            error: 'This slug is reserved and cannot be used',
        };
    }

    // Check for blocked words
    const slugParts = slug.toLowerCase().split('-');
    for (const part of slugParts) {
        if (BLOCKED_WORDS.has(part)) {
            return {
                valid: false,
                error: 'This slug contains restricted content',
            };
        }
    }

    return { valid: true };
}

/**
 * Generate a URL-safe slug from a name.
 */
export function generateSlug(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
        .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
        .replace(/\s+/g, '-') // Spaces to hyphens
        .replace(/-+/g, '-') // Collapse hyphens
        .replace(/^-|-$/g, '') // Trim hyphens
        .slice(0, 50);
}

/**
 * Generate a unique slug by appending a number if needed.
 */
export function generateUniqueSlug(
    baseName: string,
    existingSlugs: Set<string>
): string {
    const slug = generateSlug(baseName);

    if (!existingSlugs.has(slug)) {
        return slug;
    }

    let counter = 2;
    while (existingSlugs.has(`${slug}-${counter}`)) {
        counter++;
    }

    return `${slug}-${counter}`;
}
