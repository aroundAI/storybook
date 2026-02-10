/**
 * Verified Facts Types
 * Phase 11.3: FILM-1120
 *
 * Types and utilities for the verified facts system used by
 * documentary/educational content types.
 */

// =============================================================================
// SOURCE & VERIFICATION ENUMS
// =============================================================================

export type SourceType =
    | 'research_paper'
    | 'book'
    | 'news_article'
    | 'official_document'
    | 'documentary'
    | 'expert_interview'
    | 'dataset'
    | 'website'
    | 'encyclopedia'
    | 'court_document'
    | 'historical_record'
    | 'textbook'
    | 'other';

export type VerificationStatus =
    | 'unverified'
    | 'pending_review'
    | 'verified'
    | 'disputed'
    | 'retracted';

// =============================================================================
// CORE INTERFACES
// =============================================================================

/** A verified fact with citation */
export interface VerifiedFact {
    id: string;
    projectId: string;

    // The claim
    claim: string;
    simplifiedClaim?: string;

    // Categorization
    category?: string;
    subcategory?: string;
    tags: string[];

    // Source
    sourceType: SourceType;
    sourceUrl?: string;
    sourceCitation: string;
    sourceTitle?: string;
    sourceAuthors?: string[];
    sourcePublicationDate?: Date;
    sourceDoi?: string;
    sourceMetadata?: Record<string, unknown>;

    // Verification
    verificationStatus: VerificationStatus;
    verifiedBy?: string;
    verifiedAt?: Date;
    verificationNotes?: string;

    // Confidence
    confidenceScore?: number;

    // Usage
    timesUsed: number;
    lastUsedAt?: Date;
    episodesUsedIn: string[];

    // Audit
    createdAt: Date;
    createdBy?: string;
    updatedAt: Date;
    updatedBy?: string;
}

/** Input for creating a verified fact */
export interface CreateVerifiedFactInput {
    projectId: string;
    claim: string;
    category?: string;
    subcategory?: string;
    tags?: string[];
    sourceType: SourceType;
    sourceUrl?: string;
    sourceCitation: string;
    sourceTitle?: string;
    sourceAuthors?: string[];
    sourcePublicationDate?: string;
    sourceDoi?: string;
    confidenceScore?: number;
}

/** Search result for facts */
export interface FactSearchResult {
    fact: VerifiedFact;
    relevanceScore: number;
    matchedTerms: string[];
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Generate APA-format citation from source data.
 *
 * @example
 * generateAPACitation(
 *   ['Smith, J.', 'Doe, A.'],
 *   2023,
 *   'The Science of Everything',
 *   'Nature',
 *   undefined,
 *   '10.1234/nature.12345'
 * );
 * // => "Smith, J., Doe, A. (2023). The Science of Everything. Nature. https://doi.org/10.1234/nature.12345"
 */
export function generateAPACitation(
    authors: string[],
    year: number,
    title: string,
    source: string,
    url?: string,
    doi?: string,
): string {
    const formattedAuthors =
        authors.length > 0 ? authors.join(', ') : 'Unknown Author';

    let citation = `${formattedAuthors} (${year}). ${title}. ${source}.`;

    if (doi) {
        citation += ` https://doi.org/${doi}`;
    } else if (url) {
        citation += ` Retrieved from ${url}`;
    }

    return citation;
}
