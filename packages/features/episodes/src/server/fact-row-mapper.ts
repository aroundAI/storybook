/**
 * Row mapper and types for verified_facts table.
 * Extracted for testability and reuse.
 */

export interface VerifiedFactRow {
  id: string;
  project_id: string;
  claim: string;
  simplified_claim: string | null;
  category: string | null;
  subcategory: string | null;
  tags: string[] | null;
  source_type: string;
  source_url: string | null;
  source_citation: string | null;
  source_title: string | null;
  source_authors: string[] | null;
  source_publication_date: string | null;
  source_doi: string | null;
  source_metadata: unknown;
  verification_status: string;
  verified_by: string | null;
  verified_at: string | null;
  verification_notes: string | null;
  confidence_score: number | null;
  times_used: number | null;
  last_used_at: string | null;
  episodes_used_in: string[] | null;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/**
 * Maps a raw verified_facts database row to a camelCase client shape.
 * Applies defaults for nullable array/number fields.
 */
export function mapFactRow(row: VerifiedFactRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    claim: row.claim,
    simplifiedClaim: row.simplified_claim,
    category: row.category,
    subcategory: row.subcategory,
    tags: row.tags ?? [],
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    sourceCitation: row.source_citation,
    sourceTitle: row.source_title,
    sourceAuthors: row.source_authors ?? [],
    sourcePublicationDate: row.source_publication_date,
    sourceDoi: row.source_doi,
    sourceMetadata: row.source_metadata,
    verificationStatus: row.verification_status,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    verificationNotes: row.verification_notes,
    confidenceScore: row.confidence_score,
    timesUsed: row.times_used ?? 0,
    lastUsedAt: row.last_used_at,
    episodesUsedIn: row.episodes_used_in ?? [],
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/** Mapped fact shape returned by mapFactRow, for use in client components. */
export type MappedFact = ReturnType<typeof mapFactRow>;
