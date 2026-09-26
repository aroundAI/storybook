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
  -- KB-22: set when disconnected in the app; tokens wiped, row kept.
  disconnected_at TIMESTAMPTZ,
  -- KB-30: the creator's audience and category for a YouTube channel. NULL
  -- means not declared, and the app asks; there is deliberately no default.
  youtube_made_for_kids BOOLEAN,
  youtube_category_id TEXT,
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
  CONSTRAINT platform_connections_id_account_key UNIQUE (id, account_id),
  CONSTRAINT platform_connections_youtube_settings_only_youtube CHECK (
    platform = 'youtube'
    OR (youtube_made_for_kids IS NULL AND youtube_category_id IS NULL)
  ),
  CONSTRAINT platform_connections_youtube_category_numeric CHECK (
    youtube_category_id IS NULL OR youtube_category_id ~ '^[0-9]{1,3}$'
  ),
  -- A disconnected row holds no credential (KB-22).
  CONSTRAINT platform_connections_disconnected_holds_no_token CHECK (
    disconnected_at IS NULL
    OR (access_token_encrypted IS NULL AND refresh_token_encrypted IS NULL AND NOT is_active)
  )
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

-- No delete policy (KB-22): disconnect is disconnect_platform_connection(),
-- which keeps the row; only deleting the account removes it.

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

-- KB-22: writing a token is reconnecting, and clears disconnected_at; and the
-- one definition of disconnect. Bodies in
-- migrations/20260923140320_kb22-disconnect-keeps-records.sql.
CREATE TRIGGER platform_connections_reconnect
  BEFORE INSERT OR UPDATE ON public.platform_connections
  FOR EACH ROW EXECUTE FUNCTION public.platform_connections_clear_disconnected();
-- A connection row is deleted only with its account (KB-22).
CREATE TRIGGER platform_connections_refuse_delete
  BEFORE DELETE ON public.platform_connections
  FOR EACH ROW EXECUTE FUNCTION public.platform_connections_refuse_delete();
-- public.disconnect_platform_connection(p_connection_id uuid)
--   returns table (id uuid, already_disconnected boolean), security invoker;
--   reads named columns, never pc.* (KB-43; body in the KB-43/44 migration)

-- Grant permissions. Members read every column but the tokens (KB-43): the
-- OAuth callbacks write through the admin client after has_account_access,
-- and anon holds nothing (KB-44). Source of truth:
-- migrations/20260924074525_kb43-44-connection-token-grants.sql.
GRANT INSERT, UPDATE, DELETE ON public.platform_connections TO authenticated;
GRANT SELECT (
  id, account_id, platform, platform_account_id, platform_account_name,
  token_expires_at, scopes, is_active, created_at, updated_at,
  language, metadata, disconnected_at
) ON public.platform_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_connections TO service_role;
REVOKE ALL ON public.platform_connections FROM anon;

-- Comment on table
COMMENT ON TABLE public.platform_connections IS 'OAuth connections to publishing platforms (YouTube, TikTok, etc.)';
COMMENT ON COLUMN public.platform_connections.access_token_encrypted IS 'Encrypted OAuth access token';
COMMENT ON COLUMN public.platform_connections.refresh_token_encrypted IS 'Encrypted OAuth refresh token';
COMMENT ON COLUMN public.platform_connections.metadata IS 'Platform-specific metadata (e.g., channel info, avatar URL)';

-- KB-98 (20260925120329): whether a channel is null or belongs to an
-- account, for every policy on a row that names one. SECURITY DEFINER: an
-- ownership fact, the same for every caller.
CREATE OR REPLACE FUNCTION public.connection_in_account(connection_id uuid, account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  select connection_in_account.connection_id is null
      or exists (
           select 1 from public.platform_connections c
            where c.id = connection_in_account.connection_id
              and c.account_id = connection_in_account.account_id
         );
$$;

REVOKE ALL ON FUNCTION public.connection_in_account(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.connection_in_account(uuid, uuid) TO authenticated, service_role;

-- A channel (and its tokens) stays in its account; signed-in callers only.
CREATE OR REPLACE FUNCTION public.keep_account_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
begin
  if auth.uid() is not null and new.account_id is distinct from old.account_id then
    raise exception 'A % cannot move to another account', tg_argv[0]
      using errcode = '42501';
  end if;

  return new;
end;
$$;

CREATE TRIGGER platform_connections_keep_account
  BEFORE UPDATE OF account_id ON public.platform_connections
  FOR EACH ROW EXECUTE FUNCTION public.keep_account_id('channel');

-- KB-113 (20260926153937): the same freeze for a project, next to
-- keep_account_id.
CREATE TRIGGER projects_keep_account
  BEFORE UPDATE OF account_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.keep_account_id('project');
