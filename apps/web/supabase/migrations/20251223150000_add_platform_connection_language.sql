-- Migration: Add language column to platform_connections
-- 
-- Enables automatic routing of multi-language content to language-specific channels:
-- - English version → English YouTube channel
-- - Hindi version → Hindi YouTube channel
-- - etc.

-- =============================================================================
-- PLATFORM CONNECTIONS - Add language association
-- =============================================================================

-- Add language column to platform connections
-- Allows users to associate a channel with a specific language
ALTER TABLE platform_connections
ADD COLUMN IF NOT EXISTS language VARCHAR(5) NOT NULL DEFAULT 'en';

-- Index for efficient language-based channel lookup
CREATE INDEX IF NOT EXISTS idx_platform_connections_language 
ON platform_connections(account_id, platform, language);

-- Add comment for documentation
COMMENT ON COLUMN platform_connections.language IS 'Target language for this channel: en=English, hi=Hindi, es=Spanish, pt=Portuguese, etc.';
