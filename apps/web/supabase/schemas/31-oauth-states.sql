-- OAuth States Table
-- Temporary storage for OAuth state/nonce during authorization flow
-- States expire after 10 minutes and should be cleaned up regularly

CREATE TABLE IF NOT EXISTS public.oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce VARCHAR(255) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Platform must be one of the supported values
  CONSTRAINT oauth_states_platform_check
    CHECK (platform IN ('youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'linkedin'))
);

-- Enable RLS
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only read their own states
CREATE POLICY oauth_states_select_policy ON public.oauth_states
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Policy: Users can create states for themselves
CREATE POLICY oauth_states_insert_policy ON public.oauth_states
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Policy: Users can delete their own states
CREATE POLICY oauth_states_delete_policy ON public.oauth_states
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Index for looking up by nonce
CREATE INDEX IF NOT EXISTS idx_oauth_states_nonce
  ON public.oauth_states(nonce);

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_oauth_states_user_id
  ON public.oauth_states(user_id);

-- Index for cleanup queries (expired states)
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at
  ON public.oauth_states(expires_at);

-- Function to clean up expired OAuth states
CREATE OR REPLACE FUNCTION public.cleanup_expired_oauth_states()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.oauth_states
  WHERE expires_at < NOW();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Grant permissions
GRANT SELECT, INSERT, DELETE ON public.oauth_states TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.oauth_states TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_oauth_states() TO service_role;

-- Comment on table
COMMENT ON TABLE public.oauth_states IS 'Temporary OAuth state storage for CSRF protection';
COMMENT ON COLUMN public.oauth_states.nonce IS 'Unique nonce for state validation';
COMMENT ON COLUMN public.oauth_states.metadata IS 'Additional state data (e.g., PKCE code verifier for TikTok)';
COMMENT ON COLUMN public.oauth_states.expires_at IS 'State expiration time (typically 10 minutes)';
