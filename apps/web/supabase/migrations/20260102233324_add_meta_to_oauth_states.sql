-- Add 'meta' to oauth_states platform check constraint
-- Meta is used for Instagram/Facebook OAuth (Meta Business Suite)

-- Drop the existing constraint
ALTER TABLE public.oauth_states DROP CONSTRAINT IF EXISTS oauth_states_platform_check;

-- Add updated constraint with 'meta'
ALTER TABLE public.oauth_states ADD CONSTRAINT oauth_states_platform_check
  CHECK (platform IN ('youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'linkedin', 'meta'));
