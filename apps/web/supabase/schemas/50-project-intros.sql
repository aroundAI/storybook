-- ==================================
-- Project Intros Schema
-- ==================================
-- Multi-language intro video support for projects
-- Language-agnostic design - supports any language code
-- Follows MakerKit account-scoped patterns

-- Project intros table
CREATE TABLE IF NOT EXISTS public.project_intros (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  
  -- Language code (ISO 639-1 or custom): 'en', 'hi', 'es', 'pt', 'it', 'ar', etc.
  -- NOT an enum - supports any language without code changes
  language VARCHAR(10) NOT NULL,
  language_label VARCHAR(100), -- Human-readable: "English", "Hindi", "Italian"
  
  -- Intro video/audio details
  video_url TEXT NOT NULL,              -- S3/Supabase storage URL
  duration_seconds DECIMAL(10,2) NOT NULL,
  thumbnail_url TEXT,
  
  -- Metadata
  file_name VARCHAR(255),
  file_size_bytes BIGINT,
  mime_type VARCHAR(100),
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- One active intro per language per project
  UNIQUE (project_id, language)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS ix_project_intros_project_id ON public.project_intros (project_id);
CREATE INDEX IF NOT EXISTS ix_project_intros_language ON public.project_intros (project_id, language);
CREATE INDEX IF NOT EXISTS ix_project_intros_active ON public.project_intros (project_id, is_active) WHERE is_active = true;

-- Timestamps trigger
CREATE TRIGGER project_intros_set_timestamps
BEFORE INSERT OR UPDATE ON public.project_intros
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

-- ==================================
-- RLS Policies
-- ==================================

-- Enable RLS
ALTER TABLE public.project_intros ENABLE ROW LEVEL SECURITY;

-- Revoke default permissions
REVOKE ALL ON public.project_intros FROM authenticated, service_role;

-- Grant specific permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.project_intros TO authenticated;

-- Read policy: Can read if user has access to the project
CREATE POLICY "project_intros_read" ON public.project_intros FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_intros.project_id
      AND (
        -- Personal account: user is the primary owner-- Team account: user has a role
        public.has_role_on_account(p.account_id)
      )
    )
  );

-- Create policy: Can create if user has edit permission on project
CREATE POLICY "project_intros_create" ON public.project_intros FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_intros.project_id
      AND pm.user_id = auth.uid()
      AND pm.role IN ('owner', 'admin')
    )
  );

-- Update policy: Can update if user has edit permission on project
CREATE POLICY "project_intros_update" ON public.project_intros FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_intros.project_id
      AND pm.user_id = auth.uid()
      AND pm.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_intros.project_id
      AND pm.user_id = auth.uid()
      AND pm.role IN ('owner', 'admin')
    )
  );

-- Delete policy: Can delete if user has edit permission on project
CREATE POLICY "project_intros_delete" ON public.project_intros FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_intros.project_id
      AND pm.user_id = auth.uid()
      AND pm.role IN ('owner', 'admin')
    )
  );

-- ==================================
-- Comments for documentation
-- ==================================

COMMENT ON TABLE public.project_intros IS 'Stores intro videos for projects with multi-language support';
COMMENT ON COLUMN public.project_intros.language IS 'ISO 639-1 language code or custom code (e.g., en, hi, es, pt, it)';
COMMENT ON COLUMN public.project_intros.language_label IS 'Human-readable language name (e.g., English, Hindi, Italian)';
COMMENT ON COLUMN public.project_intros.video_url IS 'Storage URL for the intro video file';
COMMENT ON COLUMN public.project_intros.duration_seconds IS 'Duration of the intro video in seconds';
COMMENT ON COLUMN public.project_intros.is_active IS 'Whether this intro should be used during rendering';
