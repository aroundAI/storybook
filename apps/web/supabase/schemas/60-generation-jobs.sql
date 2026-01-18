-- ============================================================================
-- Generation Jobs Table
-- Tracks background LLM generation jobs for episodes
-- ============================================================================

-- Table: generation_jobs
-- Tracks status of async generation jobs (story, screenplay, shots)
CREATE TABLE IF NOT EXISTS public.generation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id UUID NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL, -- 'story-generation', 'screenplay-conversion', 'shot-generation'
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- Index for finding active jobs by episode
CREATE INDEX IF NOT EXISTS idx_generation_jobs_episode_active
    ON public.generation_jobs(episode_id, job_type)
    WHERE status IN ('pending', 'processing');

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status_created
    ON public.generation_jobs(status, created_at);

-- Comments
COMMENT ON TABLE public.generation_jobs IS 'Tracks background LLM generation jobs for episodes';
COMMENT ON COLUMN public.generation_jobs.job_type IS 'Type of job: story-generation, screenplay-conversion, shot-generation';
COMMENT ON COLUMN public.generation_jobs.status IS 'Job status: pending, processing, completed, failed';
COMMENT ON COLUMN public.generation_jobs.metadata IS 'Additional job metadata (model, cost, etc.)';

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view jobs for episodes in projects they can access
CREATE POLICY generation_jobs_select_policy ON public.generation_jobs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.episodes e
            JOIN public.projects p ON p.id = e.project_id
            JOIN public.accounts_memberships am ON am.account_id = p.account_id
            WHERE e.id = generation_jobs.episode_id
            AND am.user_id = auth.uid()
        )
    );

-- Policy: Users can insert jobs for episodes they can edit
CREATE POLICY generation_jobs_insert_policy ON public.generation_jobs
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.episodes e
            JOIN public.projects p ON p.id = e.project_id
            JOIN public.accounts_memberships am ON am.account_id = p.account_id
            WHERE e.id = generation_jobs.episode_id
            AND am.user_id = auth.uid()
        )
    );

-- Policy: Service role can update jobs (Lambda handlers)
CREATE POLICY generation_jobs_update_service_policy ON public.generation_jobs
    FOR UPDATE USING (true);
