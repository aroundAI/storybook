-- Platform Connections Table
-- Stores OAuth tokens for publishing platforms (YouTube, TikTok, Instagram, Facebook)
-- Tokens are encrypted at application level before storage

-- Create platform connections table
CREATE TABLE IF NOT EXISTS public.platform_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  platform_account_id VARCHAR(255),
  platform_account_name VARCHAR(255),
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[],
  metadata JSONB DEFAULT '{}'::jsonb,
  -- Target language for this channel, so multi-language content can be routed
  -- to the channel that serves that language. Added by migration
  -- 20251223150000_add_platform_connection_language.sql; declared here so this
  -- file matches the database. (`db diff` would read its absence as a DROP;
  -- this repo writes migrations by hand and does not run it.)
  language VARCHAR(5) DEFAULT 'en' NOT NULL,
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Platform must be one of the supported values
  CONSTRAINT platform_connections_platform_check
    CHECK (platform IN ('youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'linkedin')),

  -- Unique connection per account + platform + platform account
  CONSTRAINT platform_connections_unique
    UNIQUE(account_id, platform, platform_account_id),
  -- Referenced by channel_analytics_settings' composite foreign key, so a
  -- per-channel override cannot be filed under an account that does not own
  -- the channel. Adds no meaningful cost: (id, account_id) is unique wherever
  -- id already is.
  CONSTRAINT platform_connections_id_account_key UNIQUE (id, account_id)
);

-- Enable RLS
ALTER TABLE public.platform_connections ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own account's connections
CREATE POLICY platform_connections_select_policy ON public.platform_connections
  FOR SELECT
  TO authenticated
  USING (
    public.has_role_on_account(account_id)
  );

-- Policy: Users can insert connections for their accounts
CREATE POLICY platform_connections_insert_policy ON public.platform_connections
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role_on_account(account_id)
  );

-- Policy: Users can update their own account's connections
CREATE POLICY platform_connections_update_policy ON public.platform_connections
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role_on_account(account_id)
  )
  WITH CHECK (
    public.has_role_on_account(account_id)
  );

-- Policy: Users can delete their own account's connections
CREATE POLICY platform_connections_delete_policy ON public.platform_connections
  FOR DELETE
  TO authenticated
  USING (
    public.has_role_on_account(account_id)
  );

-- Index for querying by account
CREATE INDEX IF NOT EXISTS idx_platform_connections_account_id
  ON public.platform_connections(account_id);

-- Index for querying by account + platform
CREATE INDEX IF NOT EXISTS idx_platform_connections_platform
  ON public.platform_connections(account_id, platform);

-- Index for querying active connections
CREATE INDEX IF NOT EXISTS idx_platform_connections_active
  ON public.platform_connections(account_id, is_active)
  WHERE is_active = TRUE;

-- Index for token refresh queries (find expiring tokens)
CREATE INDEX IF NOT EXISTS idx_platform_connections_expires_at
  ON public.platform_connections(token_expires_at)
  WHERE token_expires_at IS NOT NULL AND is_active = TRUE;

-- Trigger to auto-update timestamps
CREATE TRIGGER platform_connections_set_timestamps
  BEFORE INSERT OR UPDATE ON public.platform_connections
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_connections TO service_role;

-- Comment on table
COMMENT ON TABLE public.platform_connections IS 'OAuth connections to publishing platforms (YouTube, TikTok, etc.)';
COMMENT ON COLUMN public.platform_connections.access_token_encrypted IS 'Encrypted OAuth access token';
COMMENT ON COLUMN public.platform_connections.refresh_token_encrypted IS 'Encrypted OAuth refresh token';
COMMENT ON COLUMN public.platform_connections.metadata IS 'Platform-specific metadata (e.g., channel info, avatar URL)';
