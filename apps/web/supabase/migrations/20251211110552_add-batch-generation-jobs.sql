-- Migration: add-batch-generation-jobs
-- Description: Creates the batch_generation_jobs table for tracking batch voice generation

-- Create batch_generation_jobs table
CREATE TABLE IF NOT EXISTS public.batch_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'queued' NOT NULL,
  total_lines INTEGER NOT NULL,
  completed_lines INTEGER DEFAULT 0 NOT NULL,
  failed_lines INTEGER DEFAULT 0 NOT NULL,
  estimated_cost INTEGER NOT NULL,
  actual_cost INTEGER DEFAULT 0 NOT NULL,
  voice_assignments JSONB NOT NULL DEFAULT '{}'::jsonb,
  errors JSONB DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT batch_job_status_check CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled'))
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_batch_jobs_episode ON public.batch_generation_jobs(episode_id);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_account_status ON public.batch_generation_jobs(account_id, status);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status_active ON public.batch_generation_jobs(status)
  WHERE status IN ('queued', 'processing');

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION public.update_batch_generation_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_batch_generation_jobs_updated_at
  BEFORE UPDATE ON public.batch_generation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_batch_generation_jobs_updated_at();

-- Enable RLS
ALTER TABLE public.batch_generation_jobs ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access batch jobs for accounts they belong to
CREATE POLICY "Users can view batch jobs for their accounts"
  ON public.batch_generation_jobs
  FOR SELECT
  USING (
    account_id IN (
      SELECT account_id FROM public.accounts_memberships
      WHERE user_id = auth.uid()
    )
    OR account_id = auth.uid()
  );

CREATE POLICY "Users can insert batch jobs for their accounts"
  ON public.batch_generation_jobs
  FOR INSERT
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM public.accounts_memberships
      WHERE user_id = auth.uid()
    )
    OR account_id = auth.uid()
  );

CREATE POLICY "Users can update batch jobs for their accounts"
  ON public.batch_generation_jobs
  FOR UPDATE
  USING (
    account_id IN (
      SELECT account_id FROM public.accounts_memberships
      WHERE user_id = auth.uid()
    )
    OR account_id = auth.uid()
  );

-- Add comment for documentation
COMMENT ON TABLE public.batch_generation_jobs IS 'Tracks batch voice generation jobs for episodes, including progress and error tracking';
COMMENT ON COLUMN public.batch_generation_jobs.voice_assignments IS 'JSON object mapping character_asset_id to voiceId and settings';
COMMENT ON COLUMN public.batch_generation_jobs.errors IS 'Array of error objects with dialogueLineId, error message, and timestamp';
