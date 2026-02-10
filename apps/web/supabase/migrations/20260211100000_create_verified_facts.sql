-- FILM-1120: Create verified_facts table for documentary content
-- Stores facts with citations, sources, and verification status.

-- Helper: reusable updated_at trigger function (if not exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the table
CREATE TABLE verified_facts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Ownership
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,

  -- The fact itself
  claim TEXT NOT NULL,
  simplified_claim TEXT,

  -- Categorization
  category VARCHAR(100),
  subcategory VARCHAR(100),
  tags TEXT[] DEFAULT '{}',

  -- Source information
  source_type VARCHAR(50) CHECK (source_type IN (
    'research_paper',
    'textbook',
    'encyclopedia',
    'expert_interview',
    'official_document',
    'historical_record',
    'news_article',
    'other'
  )),

  source_url TEXT,
  source_citation TEXT,
  source_title TEXT,
  source_authors TEXT[],
  source_publication_date DATE,
  source_doi TEXT,
  source_metadata JSONB DEFAULT '{}',

  -- Verification
  verification_status VARCHAR(20) DEFAULT 'unverified' CHECK (
    verification_status IN (
      'unverified',
      'pending_review',
      'verified',
      'disputed',
      'retracted'
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

-- INSERT: users can add facts but NOT set verification status/verified_by
-- Those columns use defaults (unverified/null) and can only be set via
-- server-side service-role calls after proper review.
CREATE POLICY "Users can insert facts for their projects"
  ON verified_facts FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT id FROM projects WHERE account_id = auth.uid()
    )
    AND (verification_status IS NULL OR verification_status = 'unverified')
    AND verified_by IS NULL
    AND verified_at IS NULL
  );

-- UPDATE: users can edit fact content but cannot change verification status
CREATE POLICY "Users can update facts for their projects"
  ON verified_facts FOR UPDATE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE account_id = auth.uid()
    )
  )
  WITH CHECK (
    -- Prevent users from modifying verification columns
    verification_status = OLD.verification_status
    AND verified_by IS NOT DISTINCT FROM OLD.verified_by
    AND verified_at IS NOT DISTINCT FROM OLD.verified_at
  );

-- DELETE: users can remove facts from their own projects
CREATE POLICY "Users can delete facts for their projects"
  ON verified_facts FOR DELETE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE account_id = auth.uid()
    )
  );
