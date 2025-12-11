-- Migration: Add voice cloning support
-- FILM-510: Voice Cloning with ElevenLabs API

-- Extend voice_profiles table with cloning columns
ALTER TABLE public.voice_profiles ADD COLUMN IF NOT EXISTS clone_status VARCHAR(50);
ALTER TABLE public.voice_profiles ADD COLUMN IF NOT EXISTS clone_samples TEXT[];
ALTER TABLE public.voice_profiles ADD COLUMN IF NOT EXISTS clone_metadata JSONB DEFAULT '{}';

-- Add check constraint for clone_status
ALTER TABLE public.voice_profiles DROP CONSTRAINT IF EXISTS voice_profiles_clone_status_check;
ALTER TABLE public.voice_profiles ADD CONSTRAINT voice_profiles_clone_status_check
  CHECK (clone_status IS NULL OR clone_status IN ('pending', 'training', 'ready', 'failed'));

-- Voice consent tracking table for legal compliance
CREATE TABLE IF NOT EXISTS public.voice_consent (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  voice_profile_id UUID NOT NULL REFERENCES public.voice_profiles(asset_id) ON DELETE CASCADE,
  consenter_name VARCHAR(255) NOT NULL,
  consenter_email VARCHAR(255),
  consent_type VARCHAR(50) NOT NULL,
  consent_text TEXT NOT NULL,
  consent_signature TEXT,
  ip_address INET,
  consented_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT voice_consent_type_check CHECK (consent_type IN ('self', 'other_authorized')),
  CONSTRAINT voice_consent_voice_profile_unique UNIQUE (voice_profile_id)
);

-- Enable RLS on voice_consent
ALTER TABLE public.voice_consent ENABLE ROW LEVEL SECURITY;

-- Revoke default permissions
REVOKE ALL ON public.voice_consent FROM authenticated, service_role;

-- Grant specific permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voice_consent TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voice_consent TO service_role;

-- RLS policies for voice_consent
-- Policy: Users can select voice_consent if they have access to the account via the voice profile
CREATE POLICY "voice_consent_select" ON public.voice_consent FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.voice_profiles vp
      JOIN public.assets a ON a.id = vp.asset_id
      JOIN public.projects p ON p.id = a.project_id
      WHERE vp.asset_id = voice_consent.voice_profile_id
      AND public.has_role_on_account(p.account_id)
    )
  );

-- Policy: Users can insert voice_consent if they have access to the account
CREATE POLICY "voice_consent_insert" ON public.voice_consent FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.voice_profiles vp
      JOIN public.assets a ON a.id = vp.asset_id
      JOIN public.projects p ON p.id = a.project_id
      WHERE vp.asset_id = voice_consent.voice_profile_id
      AND public.has_role_on_account(p.account_id)
    )
  );

-- Policy: Users can update voice_consent if they have access to the account
CREATE POLICY "voice_consent_update" ON public.voice_consent FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.voice_profiles vp
      JOIN public.assets a ON a.id = vp.asset_id
      JOIN public.projects p ON p.id = a.project_id
      WHERE vp.asset_id = voice_consent.voice_profile_id
      AND public.has_role_on_account(p.account_id)
    )
  );

-- Policy: Users can delete voice_consent if they have access to the account
CREATE POLICY "voice_consent_delete" ON public.voice_consent FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.voice_profiles vp
      JOIN public.assets a ON a.id = vp.asset_id
      JOIN public.projects p ON p.id = a.project_id
      WHERE vp.asset_id = voice_consent.voice_profile_id
      AND public.has_role_on_account(p.account_id)
    )
  );

-- Create updated_at trigger for voice_consent
CREATE TRIGGER set_voice_consent_updated_at
  BEFORE UPDATE ON public.voice_consent
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_voice_consent_voice_profile_id ON public.voice_consent(voice_profile_id);
CREATE INDEX IF NOT EXISTS idx_voice_profiles_clone_status ON public.voice_profiles(clone_status) WHERE clone_status IS NOT NULL;
