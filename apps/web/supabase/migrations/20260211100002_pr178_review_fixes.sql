-- PR #178 Review Fix: Add NOT NULL constraints to verification_status and source_type
-- Addresses review items m5 and m7 from superpowers review

-- verification_status: should never be NULL, column already has DEFAULT 'unverified'
-- First backfill any NULL rows (shouldn't exist, but be safe)
UPDATE verified_facts SET verification_status = 'unverified' WHERE verification_status IS NULL;
ALTER TABLE verified_facts ALTER COLUMN verification_status SET NOT NULL;

-- source_type: should never be NULL for properly created facts
-- Backfill any NULL rows with 'other'
UPDATE verified_facts SET source_type = 'other' WHERE source_type IS NULL;
ALTER TABLE verified_facts ALTER COLUMN source_type SET NOT NULL;

-- Fix INSERT policy: remove NULL check on verification_status since column is now NOT NULL
DROP POLICY IF EXISTS "Users can insert facts for their projects" ON verified_facts;
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

-- m6: Document the access model
-- SELECT/INSERT use account-level membership (broader access for viewing/creating facts)
-- UPDATE uses project_members with role check (more restrictive, role-based editing)
-- DELETE uses project_members with owner/admin only (most restrictive)
-- This two-level model is intentional: anyone on the account can view/add facts,
-- but only project members with appropriate roles can modify/delete them.
COMMENT ON TABLE verified_facts IS
  'Verified facts for documentary content. Access model: SELECT/INSERT via account membership, UPDATE/DELETE via project_members role check.';
