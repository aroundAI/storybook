import { describe, expect, it } from 'vitest';

import type { VerifiedFactRow } from '../../server/fact-row-mapper';
import { mapFactRow } from '../../server/fact-row-mapper';
import {
    CATEGORY_OPTIONS,
    FACT_CATEGORIES,
    SOURCE_TYPES,
    STATUS_LABELS,
    STATUS_OPTIONS,
    STATUS_STYLES,
} from '../../components/facts/fact-constants';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<VerifiedFactRow> = {}): VerifiedFactRow {
    return {
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        project_id: '11111111-2222-3333-4444-555555555555',
        claim: 'Water boils at 100°C at standard pressure',
        simplified_claim: 'water boils 100c standard pressure',
        category: 'physics',
        subcategory: 'thermodynamics',
        tags: ['water', 'boiling'],
        source_type: 'textbook',
        source_url: 'https://example.com/textbook',
        source_citation: 'Smith (2023). Basics of Physics.',
        source_title: 'Basics of Physics',
        source_authors: ['Smith, J.'],
        source_publication_date: '2023-01-15',
        source_doi: '10.1234/physics.001',
        source_metadata: null,
        verification_status: 'verified',
        verified_by: 'user-1',
        verified_at: '2024-01-01T00:00:00Z',
        verification_notes: 'Confirmed via multiple textbooks',
        confidence_score: 0.95,
        times_used: 3,
        last_used_at: '2024-06-01T00:00:00Z',
        episodes_used_in: ['ep-1', 'ep-2'],
        created_at: '2023-12-01T00:00:00Z',
        created_by: 'user-1',
        updated_at: '2024-01-01T00:00:00Z',
        updated_by: 'user-1',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// mapFactRow
// ---------------------------------------------------------------------------

describe('mapFactRow', () => {
    it('should convert snake_case fields to camelCase', () => {
        const row = makeRow();
        const mapped = mapFactRow(row);

        expect(mapped.id).toBe(row.id);
        expect(mapped.projectId).toBe(row.project_id);
        expect(mapped.claim).toBe(row.claim);
        expect(mapped.simplifiedClaim).toBe(row.simplified_claim);
        expect(mapped.category).toBe(row.category);
        expect(mapped.subcategory).toBe(row.subcategory);
        expect(mapped.sourceType).toBe(row.source_type);
        expect(mapped.sourceUrl).toBe(row.source_url);
        expect(mapped.sourceCitation).toBe(row.source_citation);
        expect(mapped.sourceTitle).toBe(row.source_title);
        expect(mapped.sourcePublicationDate).toBe(row.source_publication_date);
        expect(mapped.sourceDoi).toBe(row.source_doi);
        expect(mapped.verificationStatus).toBe(row.verification_status);
        expect(mapped.verifiedBy).toBe(row.verified_by);
        expect(mapped.verifiedAt).toBe(row.verified_at);
        expect(mapped.verificationNotes).toBe(row.verification_notes);
        expect(mapped.confidenceScore).toBe(row.confidence_score);
        expect(mapped.lastUsedAt).toBe(row.last_used_at);
        expect(mapped.createdAt).toBe(row.created_at);
        expect(mapped.createdBy).toBe(row.created_by);
        expect(mapped.updatedAt).toBe(row.updated_at);
        expect(mapped.updatedBy).toBe(row.updated_by);
    });

    it('should default null tags to empty array', () => {
        const mapped = mapFactRow(makeRow({ tags: null }));
        expect(mapped.tags).toEqual([]);
    });

    it('should preserve non-null tags', () => {
        const mapped = mapFactRow(makeRow({ tags: ['a', 'b'] }));
        expect(mapped.tags).toEqual(['a', 'b']);
    });

    it('should default null source_authors to empty array', () => {
        const mapped = mapFactRow(makeRow({ source_authors: null }));
        expect(mapped.sourceAuthors).toEqual([]);
    });

    it('should preserve non-null source_authors', () => {
        const mapped = mapFactRow(makeRow({ source_authors: ['Smith, J.'] }));
        expect(mapped.sourceAuthors).toEqual(['Smith, J.']);
    });

    it('should default null times_used to 0', () => {
        const mapped = mapFactRow(makeRow({ times_used: null }));
        expect(mapped.timesUsed).toBe(0);
    });

    it('should preserve non-null times_used', () => {
        const mapped = mapFactRow(makeRow({ times_used: 5 }));
        expect(mapped.timesUsed).toBe(5);
    });

    it('should default null episodes_used_in to empty array', () => {
        const mapped = mapFactRow(makeRow({ episodes_used_in: null }));
        expect(mapped.episodesUsedIn).toEqual([]);
    });

    it('should preserve non-null episodes_used_in', () => {
        const mapped = mapFactRow(makeRow({ episodes_used_in: ['ep-1'] }));
        expect(mapped.episodesUsedIn).toEqual(['ep-1']);
    });

    it('should handle fully null optional fields', () => {
        const mapped = mapFactRow(
            makeRow({
                simplified_claim: null,
                category: null,
                subcategory: null,
                source_url: null,
                source_citation: null,
                source_title: null,
                source_doi: null,
                verified_by: null,
                verified_at: null,
                verification_notes: null,
                confidence_score: null,
                last_used_at: null,
                created_at: null,
                created_by: null,
                updated_at: null,
                updated_by: null,
            }),
        );

        expect(mapped.simplifiedClaim).toBeNull();
        expect(mapped.category).toBeNull();
        expect(mapped.subcategory).toBeNull();
        expect(mapped.sourceUrl).toBeNull();
        expect(mapped.sourceCitation).toBeNull();
        expect(mapped.sourceTitle).toBeNull();
        expect(mapped.sourceDoi).toBeNull();
        expect(mapped.verifiedBy).toBeNull();
        expect(mapped.verifiedAt).toBeNull();
        expect(mapped.verificationNotes).toBeNull();
        expect(mapped.confidenceScore).toBeNull();
        expect(mapped.lastUsedAt).toBeNull();
        expect(mapped.createdAt).toBeNull();
        expect(mapped.createdBy).toBeNull();
        expect(mapped.updatedAt).toBeNull();
        expect(mapped.updatedBy).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// fact-constants
// ---------------------------------------------------------------------------

describe('fact-constants', () => {
    describe('STATUS_STYLES', () => {
        it('should have styles for all standard statuses', () => {
            const statuses = ['unverified', 'verified', 'disputed', 'pending_review', 'retracted'];
            for (const status of statuses) {
                expect(STATUS_STYLES[status]).toBeDefined();
                expect(typeof STATUS_STYLES[status]).toBe('string');
            }
        });
    });

    describe('STATUS_LABELS', () => {
        it('should have labels for all standard statuses', () => {
            expect(STATUS_LABELS.unverified).toBe('Unverified');
            expect(STATUS_LABELS.verified).toBe('Verified');
            expect(STATUS_LABELS.disputed).toBe('Disputed');
            expect(STATUS_LABELS.pending_review).toBe('Pending Review');
            expect(STATUS_LABELS.retracted).toBe('Retracted');
        });
    });

    describe('STATUS_OPTIONS', () => {
        it('should be derived from STATUS_LABELS', () => {
            expect(STATUS_OPTIONS.length).toBe(Object.keys(STATUS_LABELS).length);
            for (const opt of STATUS_OPTIONS) {
                expect(STATUS_LABELS[opt.value]).toBe(opt.label);
            }
        });
    });

    describe('FACT_CATEGORIES', () => {
        it('should contain expected categories', () => {
            expect(FACT_CATEGORIES).toContain('physics');
            expect(FACT_CATEGORIES).toContain('biology');
            expect(FACT_CATEGORIES).toContain('history');
            expect(FACT_CATEGORIES.length).toBeGreaterThanOrEqual(10);
        });
    });

    describe('CATEGORY_OPTIONS', () => {
        it('should capitalize first letter of each category', () => {
            for (const opt of CATEGORY_OPTIONS) {
                expect(opt.label[0]).toBe(opt.label[0]!.toUpperCase());
                expect(opt.value).toBe(opt.label.toLowerCase());
            }
        });

        it('should have same length as FACT_CATEGORIES', () => {
            expect(CATEGORY_OPTIONS.length).toBe(FACT_CATEGORIES.length);
        });
    });

    describe('SOURCE_TYPES', () => {
        it('should contain expected source types', () => {
            const values = SOURCE_TYPES.map((s) => s.value);
            expect(values).toContain('research_paper');
            expect(values).toContain('book');
            expect(values).toContain('news_article');
            expect(values).toContain('other');
        });

        it('should have human-readable labels', () => {
            const paper = SOURCE_TYPES.find((s) => s.value === 'research_paper');
            expect(paper?.label).toBe('Research Paper');

            const book = SOURCE_TYPES.find((s) => s.value === 'book');
            expect(book?.label).toBe('Book');
        });

        it('should not have duplicate values', () => {
            const values = SOURCE_TYPES.map((s) => s.value);
            expect(new Set(values).size).toBe(values.length);
        });
    });
});
