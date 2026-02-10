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
    'book',
    'news_article',
    'official_document',
    'documentary',
    'expert_interview',
    'dataset',
    'website',
    'encyclopedia',
    'court_document',
    'historical_record',
    'textbook',
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
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = verified_facts.project_id
      AND (
        -- Personal account: user is the primary owner
        EXISTS (
          SELECT 1 FROM public.accounts a
          WHERE a.id = p.account_id
            AND a.primary_owner_user_id = auth.uid()
            AND a.is_personal_account = true
        )
        OR
        -- Team account: user has a role on the account
        public.has_role_on_account(p.account_id)
      )
    )
  );

-- INSERT: users can add facts but NOT set verification status/verified_by
-- Those columns use defaults (unverified/null) and can only be set via
-- server-side service-role calls after proper review.
CREATE POLICY "Users can insert facts for their projects"
  ON verified_facts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = verified_facts.project_id
      AND (
        EXISTS (
          SELECT 1 FROM public.accounts a
          WHERE a.id = p.account_id
            AND a.primary_owner_user_id = auth.uid()
            AND a.is_personal_account = true
        )
        OR
        public.has_role_on_account(p.account_id)
      )
    )
    AND (verification_status IS NULL OR verification_status = 'unverified')
    AND verified_by IS NULL
    AND verified_at IS NULL
    AND (created_by IS NULL OR created_by = auth.uid())
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

-- UPDATE: project members can edit facts (content-change rules enforced by trigger below)
CREATE POLICY "Users can update facts for their projects"
  ON verified_facts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = verified_facts.project_id
        AND pm.user_id = auth.uid()
        AND pm.role IN ('owner', 'admin', 'member')
    )
  );

-- Trigger: enforce business rules on UPDATE that require OLD reference
-- (RLS WITH CHECK cannot access OLD in PostgreSQL)
CREATE OR REPLACE FUNCTION enforce_verified_facts_update_rules()
RETURNS TRIGGER AS $$
BEGIN
  -- Prevent moving facts between projects
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'Cannot move a fact to a different project';
  END IF;

  -- Protect audit columns
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Cannot change created_by';
  END IF;

  -- If any content or source field changed, reset verification to unverified
  IF NEW.claim IS DISTINCT FROM OLD.claim
     OR NEW.source_type IS DISTINCT FROM OLD.source_type
     OR NEW.source_citation IS DISTINCT FROM OLD.source_citation
     OR NEW.source_url IS DISTINCT FROM OLD.source_url
     OR NEW.source_title IS DISTINCT FROM OLD.source_title
     OR NEW.source_authors IS DISTINCT FROM OLD.source_authors
     OR NEW.source_publication_date IS DISTINCT FROM OLD.source_publication_date
     OR NEW.source_doi IS DISTINCT FROM OLD.source_doi
  THEN
    NEW.verification_status := 'unverified';
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
  END IF;

  -- Set updated_by to current user
  NEW.updated_by := auth.uid();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER enforce_verified_facts_update
  BEFORE UPDATE ON verified_facts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_verified_facts_update_rules();

-- DELETE: only owners and admins can remove facts
CREATE POLICY "Users can delete facts for their projects"
  ON verified_facts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = verified_facts.project_id
        AND pm.user_id = auth.uid()
        AND pm.role IN ('owner', 'admin')
    )
  );
