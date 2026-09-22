---
id: FILM-1120
title: Verified Facts Database Table
status: 🟡 PARTIAL
audited: 2026-09-23
priority: high
effort: M
dependencies: []
---

# FILM-1120: Verified Facts Database Table

## Overview

Create a database table for storing verified facts with citations, sources, and verification status. This is the foundation for DOCUMENTARY content type that requires factual accuracy.

## Problem Statement

For documentary/educational content (like Cosmos, Mythbusters):
- Facts must be verifiable with sources
- Citations must be in proper format (APA, MLA)
- Need to track verification status
- Need confidence scoring
- LLM should NOT make up facts - only use verified ones

## Solution

Create a `verified_facts` table that stores facts with their source citations and verification status.

---

## Database Schema

### Migration File

```sql
-- Migration: create_verified_facts_table

-- Create the table
CREATE TABLE verified_facts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Ownership
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  
  -- The fact itself
  claim TEXT NOT NULL,                    -- The factual statement
  simplified_claim TEXT,                   -- Normalized for matching
  
  -- Categorization
  category VARCHAR(100),                   -- "physics", "history", "biology", etc.
  subcategory VARCHAR(100),
  tags TEXT[] DEFAULT '{}',
  
  -- Source information
  source_type VARCHAR(50) CHECK (source_type IN (
    'research_paper',    -- Peer-reviewed journal
    'textbook',          -- Academic textbook
    'encyclopedia',      -- Encyclopedia entry
    'expert_interview',  -- Interview with subject matter expert
    'official_document', -- Government/official publication
    'historical_record', -- Primary historical source
    'news_article',      -- Credible news source
    'other'
  )),
  
  source_url TEXT,                         -- Link to source
  source_citation TEXT,                    -- Full citation (APA format)
  source_title TEXT,                       -- Publication title
  source_authors TEXT[],                   -- Author names
  source_publication_date DATE,
  source_doi TEXT,                         -- Digital Object Identifier
  source_metadata JSONB DEFAULT '{}',      -- Additional source info
  
  -- Verification
  verification_status VARCHAR(20) DEFAULT 'unverified' CHECK (
    verification_status IN (
      'unverified',      -- Not yet verified
      'pending_review',  -- Submitted for review
      'verified',        -- Confirmed accurate
      'disputed',        -- Conflicting sources
      'retracted'        -- Source was retracted
    )
  ),
  verified_by UUID REFERENCES auth.users,
  verified_at TIMESTAMPTZ,
  verification_notes TEXT,
  
  -- Confidence scoring
  confidence_score DECIMAL(3,2) CHECK (
    confidence_score >= 0 AND confidence_score <= 1
  ),
  
  -- Usage tracking
  times_used INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  episodes_used_in UUID[] DEFAULT '{}',
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES auth.users
);

-- Indexes
CREATE INDEX idx_verified_facts_project ON verified_facts(project_id);
CREATE INDEX idx_verified_facts_status ON verified_facts(verification_status);
CREATE INDEX idx_verified_facts_category ON verified_facts(project_id, category);
CREATE INDEX idx_verified_facts_tags ON verified_facts USING GIN(tags);

-- Full-text search on claims
CREATE INDEX idx_verified_facts_claim_search ON verified_facts 
  USING GIN(to_tsvector('english', claim || ' ' || COALESCE(simplified_claim, '')));

-- Trigger for updated_at
CREATE TRIGGER set_verified_facts_updated_at
  BEFORE UPDATE ON verified_facts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE verified_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view facts for their projects"
  ON verified_facts FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM projects WHERE account_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert facts for their projects"
  ON verified_facts FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT id FROM projects WHERE account_id = auth.uid()
    )
  );

CREATE POLICY "Users can update facts for their projects"
  ON verified_facts FOR UPDATE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE account_id = auth.uid()
    )
  );
```

---

## TypeScript Types

### File: `packages/features/episodes/src/types/verified-facts.ts`

```typescript
/**
 * Source types for verified facts
 */
export type SourceType =
  | 'research_paper'
  | 'textbook'
  | 'encyclopedia'
  | 'expert_interview'
  | 'official_document'
  | 'historical_record'
  | 'news_article'
  | 'other';

/**
 * Verification status
 */
export type VerificationStatus =
  | 'unverified'
  | 'pending_review'
  | 'verified'
  | 'disputed'
  | 'retracted';

/**
 * A verified fact with citation
 */
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
  sourceCitation: string;           // Full citation
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
}

/**
 * Input for creating a verified fact
 */
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

/**
 * Search result for facts
 */
export interface FactSearchResult {
  fact: VerifiedFact;
  relevanceScore: number;
  matchedTerms: string[];
}

/**
 * Generate APA citation from source data
 */
export function generateAPACitation(
  authors: string[],
  year: number,
  title: string,
  source: string,
  url?: string,
  doi?: string
): string {
  // Format authors: Last, F. M., & Last, F. M.
  const formattedAuthors = authors.length > 0
    ? authors.join(', ')
    : 'Unknown Author';
  
  let citation = `${formattedAuthors} (${year}). ${title}. ${source}.`;
  
  if (doi) {
    citation += ` https://doi.org/${doi}`;
  } else if (url) {
    citation += ` Retrieved from ${url}`;
  }
  
  return citation;
}
```

---

## Acceptance Criteria

- [x] `verified_facts` table created with all columns
- [ ] RLS policies protect project-level access — *audit: unverified* — policies exist (`apps/web/supabase/migrations/20260211100000_create_verified_facts.sql:104`); no pgTAP test asserts cross-project isolation
- [x] TypeScript types exported from @kit/episodes
- [ ] Full-text search index works for claim matching — *audit: no longer true* — the only claim search, `textSearch('claim', …)` (`packages/features/episodes/src/server/fact-actions.ts:298`), cannot use this expression index
- [x] Tags are indexed with GIN
- [ ] `generateAPACitation` produces valid APA format — *audit: no longer true* — its test pins `Watson, J. D., Crick, F. H. C. (1953)` (`packages/features/episodes/src/lib/__tests__/verified-facts.test.ts:96`); APA needs `&` before the last author
- [x] Types regenerated after migration

---

## Testing

### Unit Test

```typescript
describe('Verified Facts Types', () => {
  it('should generate APA citation', () => {
    const citation = generateAPACitation(
      ['Smith, J.', 'Doe, A.'],
      2023,
      'The Science of Everything',
      'Nature',
      undefined,
      '10.1234/nature.12345'
    );
    
    expect(citation).toContain('Smith, J., Doe, A.');
    expect(citation).toContain('(2023)');
    expect(citation).toContain('https://doi.org/10.1234');
  });
});
```

### Migration Test

```bash
pnpm --filter web supabase migration up
pnpm supabase:web:typegen

# Verify table
psql -c "\\d verified_facts"
```

---

## Estimated Effort

| Task | Time |
|------|------|
| Create migration | 30 min |
| Create TypeScript types | 30 min |
| Generate database types | 10 min |
| Testing | 30 min |
| **Total** | **~1.5 hours** |

---

## Dependencies

- None (foundational table)

## Blocks

- **FILM-1121**: Fact Management UI
- **FILM-1122**: Researcher Role
- **FILM-1123**: Fact-Checker Role

---

## Implementation Status

**Implemented** in PR #178 — merged 2026-02-10

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Full-text search index works for claim matching | The index is on `to_tsvector('english', claim \|\| ' ' \|\| COALESCE(simplified_claim, ''))` (`apps/web/supabase/migrations/20260211100000_create_verified_facts.sql:92`); the fact library searches `textSearch('claim', …)` (`packages/features/episodes/src/server/fact-actions.ts:298`), a different expression, so the index is never used. `external_content` had the same defect and was fixed with a generated `fts` column (`20260211200001_fix_external_content_fts_and_trigger.sql`) | unassigned |
| `generateAPACitation` produces valid APA format | Authors are joined with `, ` and no `&`, and a missing author becomes "Unknown Author" (`packages/features/episodes/src/types/verified-facts.ts:126`); the unit test pins that output (`packages/features/episodes/src/lib/__tests__/verified-facts.test.ts:95`) | unassigned |
