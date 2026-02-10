/**
 * Base External Provider
 * Phase 11: FILM-1135
 *
 * Abstract base class implementing common ExternalContextProvider logic:
 * rate limiting, cache TTL, availability checks.
 */

import type {
    ExternalContextProvider,
    ExternalSearchParams,
    ExternalContent,
    RateLimitStatus,
    SourceCategory,
} from '../../../types/external-context';

export abstract class BaseExternalProvider implements ExternalContextProvider {
    abstract readonly name: string;
    abstract readonly category: SourceCategory;
    abstract readonly sourceId: string;

    protected rateLimitRemaining = 100;
    protected rateLimitResetAt = new Date();
    protected cacheTTLHours = 24;

    abstract fetchContent(params: ExternalSearchParams): Promise<ExternalContent[]>;

    isAvailable(): boolean {
        return !this.getRateLimitStatus().isLimited;
    }

    getRateLimitStatus(): RateLimitStatus {
        return {
            remaining: this.rateLimitRemaining,
            resetAt: this.rateLimitResetAt,
            isLimited: this.rateLimitRemaining <= 0 && this.rateLimitResetAt > new Date(),
        };
    }

    getCacheTTL(): number {
        return this.cacheTTLHours;
    }

    protected updateRateLimit(remaining: number, resetAt?: Date): void {
        this.rateLimitRemaining = remaining;
        if (resetAt) {
            this.rateLimitResetAt = resetAt;
        }
    }

    /** Calculate cache expiry from now based on provider TTL */
    protected getCacheExpiryDate(): Date {
        return new Date(Date.now() + this.cacheTTLHours * 3600000);
    }
}
