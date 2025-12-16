-- Migration: Add lip sync jobs table
-- FILM-511: Lip Sync Library

-- Create lip_sync_jobs table
CREATE TABLE IF NOT EXISTS public.lip_sync_jobs (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  shot_id UUID NOT NULL REFERENCES public.shots(id) ON DELETE CASCADE,
  dialogue_line_id UUID NOT NULL REFERENCES public.dialogue_lines(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'queued' NOT NULL,
  input_video_url TEXT NOT NULL,
  input_audio_url TEXT NOT NULL,
  output_video_url TEXT,
  face_coordinates JSONB,
  quality VARCHAR(50) DEFAULT 'standard' NOT NULL,
  provider_job_id VARCHAR(255),
  error_message TEXT,
  processing_time_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT lip_sync_jobs_provider_check CHECK (provider IN ('synclabs', 'wav2lip')),
  CONSTRAINT lip_sync_jobs_status_check CHECK (status IN ('queued', 'pending', 'processing', 'completed', 'failed')),
  CONSTRAINT lip_sync_jobs_quality_check CHECK (quality IN ('fast', 'standard', 'high'))
);

-- Enable RLS
ALTER TABLE public.lip_sync_jobs ENABLE ROW LEVEL SECURITY;

-- Revoke default permissions
REVOKE ALL ON public.lip_sync_jobs FROM authenticated, service_role;

-- Grant specific permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lip_sync_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lip_sync_jobs TO service_role;

-- RLS Policies (access via shot -> episode -> project -> account)
CREATE POLICY "lip_sync_jobs_select" ON public.lip_sync_jobs FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.shots s
      JOIN public.episodes e ON e.id = s.episode_id
      JOIN public.projects p ON p.id = e.project_id
      WHERE s.id = lip_sync_jobs.shot_id
      AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY "lip_sync_jobs_insert" ON public.lip_sync_jobs FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shots s
      JOIN public.episodes e ON e.id = s.episode_id
      JOIN public.projects p ON p.id = e.project_id
      WHERE s.id = lip_sync_jobs.shot_id
      AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY "lip_sync_jobs_update" ON public.lip_sync_jobs FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.shots s
      JOIN public.episodes e ON e.id = s.episode_id
      JOIN public.projects p ON p.id = e.project_id
      WHERE s.id = lip_sync_jobs.shot_id
      AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY "lip_sync_jobs_delete" ON public.lip_sync_jobs FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.shots s
      JOIN public.episodes e ON e.id = s.episode_id
      JOIN public.projects p ON p.id = e.project_id
      WHERE s.id = lip_sync_jobs.shot_id
      AND public.has_role_on_account(p.account_id)
    )
  );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_lip_sync_jobs_shot_id ON public.lip_sync_jobs(shot_id);
CREATE INDEX IF NOT EXISTS idx_lip_sync_jobs_dialogue_line_id ON public.lip_sync_jobs(dialogue_line_id);
CREATE INDEX IF NOT EXISTS idx_lip_sync_jobs_status ON public.lip_sync_jobs(status) WHERE status NOT IN ('completed', 'failed');
CREATE INDEX IF NOT EXISTS idx_lip_sync_jobs_provider_job_id ON public.lip_sync_jobs(provider_job_id) WHERE provider_job_id IS NOT NULL;

-- Create updated_at trigger
CREATE TRIGGER set_lip_sync_jobs_updated_at
  BEFORE UPDATE ON public.lip_sync_jobs
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);
