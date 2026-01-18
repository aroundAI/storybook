-- ============================================================================
-- Migration: Add embedding support to audio_assets for semantic matching
-- Enables finding similar audio assets using vector similarity search
-- ============================================================================

-- 1. Add embedding column (OpenAI text-embedding-3-small = 1536 dimensions)
ALTER TABLE public.audio_assets 
ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 2. Index for fast similarity search (IVFFlat index)
CREATE INDEX IF NOT EXISTS idx_audio_assets_embedding 
ON public.audio_assets USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- 3. RPC function for semantic search
-- Returns matching assets above threshold, ordered by similarity
CREATE OR REPLACE FUNCTION match_audio_assets(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_project_id uuid
)
RETURNS TABLE (
  id uuid,
  similarity float,
  prompt text,
  file_url text,
  audio_type text,
  name text
)
LANGUAGE sql STABLE AS $$
  SELECT 
    a.id,
    1 - (a.embedding <=> query_embedding) as similarity,
    a.prompt,
    a.file_url,
    a.audio_type,
    a.name
  FROM audio_assets a
  WHERE a.project_id = p_project_id
    AND a.embedding IS NOT NULL
    AND a.status = 'completed'
    AND 1 - (a.embedding <=> query_embedding) > match_threshold
  ORDER BY a.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMENT ON COLUMN public.audio_assets.embedding IS 'Vector embedding for semantic similarity search (1536 dimensions)';
COMMENT ON FUNCTION match_audio_assets IS 'Find audio assets similar to query embedding above threshold';
