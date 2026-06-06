-- Fact Extraction Job Tracking
-- Tracks the progress of async fact extraction from uploaded sources

CREATE TABLE IF NOT EXISTS fact_extraction_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  source_title TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 1,
  chunks_completed INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  facts_extracted INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fact_extraction_jobs_project 
  ON fact_extraction_jobs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_fact_extraction_jobs_created_by 
  ON fact_extraction_jobs(created_by);

-- RLS
ALTER TABLE fact_extraction_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY fact_extraction_jobs_select ON fact_extraction_jobs
  FOR SELECT TO authenticated
  USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN accounts_memberships am ON am.account_id = p.account_id
      WHERE am.user_id = auth.uid()
    )
  );

CREATE POLICY fact_extraction_jobs_insert ON fact_extraction_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN accounts_memberships am ON am.account_id = p.account_id
      WHERE am.user_id = auth.uid()
    )
  );

CREATE POLICY fact_extraction_jobs_service ON fact_extraction_jobs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Updated_at trigger
CREATE OR REPLACE TRIGGER set_fact_extraction_jobs_updated_at
  BEFORE UPDATE ON fact_extraction_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
