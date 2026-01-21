-- Global OAuth App Credentials
-- Stores OAuth app credentials at the application level (not per-account)
-- These are the Client ID/Secret configured in Google, Meta, TikTok developer consoles

CREATE TABLE IF NOT EXISTS public.oauth_app_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL UNIQUE CHECK (platform IN ('youtube', 'tiktok', 'meta')),
  client_id TEXT NOT NULL,
  client_secret_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comment on table
COMMENT ON TABLE public.oauth_app_credentials IS 'Global OAuth app credentials (Client ID/Secret) for platform integrations. Managed by super admins only.';

-- RLS - Only super admins can access
ALTER TABLE public.oauth_app_credentials ENABLE ROW LEVEL SECURITY;

-- Super admins can read credentials
CREATE POLICY oauth_app_credentials_select ON public.oauth_app_credentials
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- Super admins can insert credentials
CREATE POLICY oauth_app_credentials_insert ON public.oauth_app_credentials
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

-- Super admins can update credentials
CREATE POLICY oauth_app_credentials_update ON public.oauth_app_credentials
  FOR UPDATE TO authenticated
  USING (public.is_super_admin());

-- Super admins can delete credentials
CREATE POLICY oauth_app_credentials_delete ON public.oauth_app_credentials
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- Service role can also access (for OAuth callback handling)
CREATE POLICY oauth_app_credentials_service ON public.oauth_app_credentials
  FOR SELECT TO service_role
  USING (true);
