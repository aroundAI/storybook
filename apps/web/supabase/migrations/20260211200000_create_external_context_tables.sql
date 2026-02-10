-- FILM-1135: Create unified external context tables
-- Provides external_sources (registry) and external_content (cache) for
-- news, research, historical archives, and other external data sources.

-- =============================================================================
-- EXTERNAL SOURCES REGISTRY
-- =============================================================================

CREATE TABLE IF NOT EXISTS external_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Source identity
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  website_url TEXT,
  logo_url TEXT,

  -- Categorization
  category VARCHAR(50) NOT NULL CHECK (category IN (
    'news', 'research', 'encyclopedia', 'historical', 'official', 'multimedia'
  )),

  -- API configuration
  provider_type VARCHAR(50) NOT NULL, -- 'newsapi', 'semantic_scholar', 'archive_org', etc.
  api_endpoint TEXT,
  api_key_env VARCHAR(100),           -- Environment variable name for API key
  config JSONB DEFAULT '{}',          -- Provider-specific configuration

  -- Credibility
  credibility_tier VARCHAR(20) DEFAULT 'tier_3' CHECK (
    credibility_tier IN ('tier_1', 'tier_2', 'tier_3')
  ),
  bias_label VARCHAR(50),
  peer_reviewed BOOLEAN DEFAULT false,

  -- Rate limiting
  rate_limit_per_hour INTEGER DEFAULT 100,
  current_usage INTEGER DEFAULT 0,
  usage_reset_at TIMESTAMPTZ,

  -- Cache settings
  cache_ttl_hours INTEGER DEFAULT 24,

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- EXTERNAL CONTENT CACHE
-- =============================================================================

CREATE TABLE IF NOT EXISTS external_content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Source reference
  external_id VARCHAR(500) NOT NULL,
  source_id UUID REFERENCES external_sources(id) ON DELETE CASCADE NOT NULL,

  -- Core content
  title TEXT NOT NULL,
  description TEXT,
  content TEXT,
  url TEXT NOT NULL,

  -- Metadata
  authors TEXT[] DEFAULT '{}',
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  language VARCHAR(10) DEFAULT 'en',

  -- Categorization (denormalized for performance)
  category VARCHAR(50) NOT NULL,
  topics TEXT[] DEFAULT '{}',
  entities JSONB DEFAULT '{}',

  -- Research-specific
  doi VARCHAR(100),
  journal VARCHAR(300),
  citations INTEGER,
  peer_reviewed BOOLEAN DEFAULT false,

  -- News-specific
  image_url TEXT,

  -- Credibility (denormalized)
  credibility_tier VARCHAR(20),
  bias_label VARCHAR(50),

  -- Cache management
  fetched_at TIMESTAMPTZ DEFAULT now(),
  cache_expires_at TIMESTAMPTZ,

  -- Unique constraint on external_id
  CONSTRAINT uq_external_content_external_id UNIQUE (external_id)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX idx_external_sources_category ON external_sources(category, is_active);
CREATE INDEX idx_external_sources_provider_type ON external_sources(provider_type);

CREATE INDEX idx_external_content_source ON external_content(source_id);
CREATE INDEX idx_external_content_category ON external_content(category);
CREATE INDEX idx_external_content_published ON external_content(published_at DESC);
CREATE INDEX idx_external_content_topics ON external_content USING GIN(topics);
CREATE INDEX idx_external_content_entities ON external_content USING GIN(entities);
CREATE INDEX idx_external_content_cache ON external_content(cache_expires_at);

-- Full-text search on title + description
CREATE INDEX idx_external_content_fts ON external_content
  USING GIN(to_tsvector('english', title || ' ' || COALESCE(description, '')));

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================

CREATE TRIGGER set_external_sources_updated_at
  BEFORE UPDATE ON external_sources
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE external_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_content ENABLE ROW LEVEL SECURITY;

-- Sources: authenticated users can view active sources
CREATE POLICY "Anyone can view active sources"
  ON external_sources FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Sources: only service role can insert/update/delete
CREATE POLICY "Service role manages sources"
  ON external_sources FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Content: authenticated users can read cached content
CREATE POLICY "Authenticated users can view content"
  ON external_content FOR SELECT
  TO authenticated
  USING (true);

-- Content: service role can manage cache entries
CREATE POLICY "Service role manages content cache"
  ON external_content FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE external_sources IS
  'FILM-1135: Registry of external data sources (news, research, archives). Global reference data.';

COMMENT ON TABLE external_content IS
  'FILM-1135: Cached content from external sources. TTL-based expiry per source category.';
