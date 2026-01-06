-- Account OAuth Apps
-- Stores OAuth app credentials per account (Client ID + encrypted Secret)
-- Each account can have one set of credentials per platform

CREATE TABLE IF NOT EXISTS public.account_oauth_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'meta')),
  client_id TEXT NOT NULL,
  client_secret_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, platform)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_account_oauth_apps_account_id 
  ON public.account_oauth_apps(account_id);

-- RLS
ALTER TABLE public.account_oauth_apps ENABLE ROW LEVEL SECURITY;

-- Policy: Account owners can read their OAuth apps
CREATE POLICY account_oauth_apps_select ON public.account_oauth_apps
  FOR SELECT TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM public.accounts_memberships 
      WHERE user_id = auth.uid()
    )
  );

-- Policy: Account owners can insert OAuth apps
CREATE POLICY account_oauth_apps_insert ON public.account_oauth_apps
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM public.accounts_memberships 
      WHERE user_id = auth.uid() 
      AND account_role = 'owner'
    )
  );

-- Policy: Account owners can update their OAuth apps
CREATE POLICY account_oauth_apps_update ON public.account_oauth_apps
  FOR UPDATE TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM public.accounts_memberships 
      WHERE user_id = auth.uid() 
      AND account_role = 'owner'
    )
  );

-- Policy: Account owners can delete their OAuth apps
CREATE POLICY account_oauth_apps_delete ON public.account_oauth_apps
  FOR DELETE TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM public.accounts_memberships 
      WHERE user_id = auth.uid() 
      AND account_role = 'owner'
    )
  );
