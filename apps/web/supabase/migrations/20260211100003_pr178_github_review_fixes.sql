-- PR #178 GitHub Review Fixes
-- Addresses 6 comments from automated code review

-- ============================================================
-- C3 (Medium): Convert source_type to ENUM
-- ============================================================
DO $$ BEGIN
  CREATE TYPE source_type_enum AS ENUM (
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
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Drop the existing CHECK constraint before changing type
ALTER TABLE verified_facts DROP CONSTRAINT IF EXISTS verified_facts_source_type_check;

ALTER TABLE verified_facts
  ALTER COLUMN source_type TYPE source_type_enum
  USING source_type::source_type_enum;

-- ============================================================
-- C4 (Medium): Convert verification_status to ENUM
-- ============================================================
DO $$ BEGIN
  CREATE TYPE verification_status_enum AS ENUM (
    'unverified',
    'pending_review',
    'verified',
    'disputed',
    'retracted'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Drop the existing CHECK constraint before changing type
ALTER TABLE verified_facts DROP CONSTRAINT IF EXISTS verified_facts_verification_status_check;

-- Must drop policies that depend on verification_status before ALTER TYPE
DROP POLICY IF EXISTS "Users can insert facts for their projects" ON verified_facts;
DROP POLICY IF EXISTS "Users can update facts for their projects" ON verified_facts;

-- Must drop default before ALTER TYPE, then re-set it as ENUM literal
ALTER TABLE verified_facts
  ALTER COLUMN verification_status DROP DEFAULT;

ALTER TABLE verified_facts
  ALTER COLUMN verification_status TYPE verification_status_enum
  USING verification_status::verification_status_enum;

ALTER TABLE verified_facts
  ALTER COLUMN verification_status SET DEFAULT 'unverified'::verification_status_enum;

-- Recreate INSERT policy (from 20260211100002, unchanged)
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
    AND verification_status = 'unverified'
    AND verified_by IS NULL
    AND verified_at IS NULL
    AND (created_by IS NULL OR created_by = auth.uid())
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

-- ============================================================
-- C1 (High-Security): Add WITH CHECK to UPDATE policy
-- Prevents users from self-verifying facts via direct UPDATE.
-- Only service-role can set verification_status to 'verified'.
-- ============================================================
CREATE POLICY "Users can update facts for their projects"
  ON verified_facts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = verified_facts.project_id
        AND pm.user_id = auth.uid()
        AND pm.role IN ('owner', 'admin', 'member')
    )
  )
  WITH CHECK (
    -- Users can only set status to unverified or pending_review.
    -- 'verified', 'disputed', 'retracted' require service-role access.
    (verification_status = 'unverified' OR verification_status = 'pending_review')
    AND verified_by IS NULL
    AND verified_at IS NULL
  );

-- ============================================================
-- C5 (Low): Change confidence_score from DECIMAL to NUMERIC
-- ============================================================
ALTER TABLE verified_facts
  ALTER COLUMN confidence_score TYPE NUMERIC(3,2);

-- ============================================================
-- C6 (Low): Make parent_project_name nullable
-- Application code already handles NULL with ?? ''
-- ============================================================
ALTER TABLE sequel_parent_contexts
  ALTER COLUMN parent_project_name DROP NOT NULL,
  ALTER COLUMN parent_project_name DROP DEFAULT;

UPDATE sequel_parent_contexts
  SET parent_project_name = NULL
  WHERE parent_project_name = '';
