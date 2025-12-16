-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- Episode embeddings for semantic similarity search
CREATE TABLE IF NOT EXISTS episode_embeddings (
  episode_id UUID PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  premise_embedding VECTOR(1024),  -- Voyage-large-2 embeddings
  story_embedding VECTOR(1024),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast similarity search on premise embeddings
CREATE INDEX IF NOT EXISTS episode_premise_embedding_idx 
  ON episode_embeddings 
  USING ivfflat (premise_embedding vector_cosine_ops)
  WITH (lists = 100);

-- Index for fast similarity search on story embeddings
CREATE INDEX IF NOT EXISTS episode_story_embedding_idx 
  ON episode_embeddings 
  USING ivfflat (story_embedding vector_cosine_ops)
  WITH (lists = 100);

-- Character embeddings for semantic character discovery
CREATE TABLE IF NOT EXISTS character_embeddings (
  character_id UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  description_embedding VECTOR(1024),
  personality_embedding VECTOR(1024),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for character description similarity search
CREATE INDEX IF NOT EXISTS character_description_embedding_idx 
  ON character_embeddings 
  USING ivfflat (description_embedding vector_cosine_ops)
  WITH (lists = 100);

-- Function to search for similar episodes based on premise
CREATE OR REPLACE FUNCTION search_similar_episodes(
  query_embedding VECTOR(1024),
  target_season_id UUID,
  exclude_episode_id UUID,
  match_threshold FLOAT DEFAULT 0.75,
  match_count INT DEFAULT 3
)
RETURNS TABLE (
  episode_id UUID,
  number INT,
  title VARCHAR,
  story_summary TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.id,
    e.number,
    e.title,
    SUBSTRING(e.story_data->>'fullStory', 1, 300) as story_summary,
    1 - (ee.premise_embedding <=> query_embedding) as similarity
  FROM episodes e
  INNER JOIN episode_embeddings ee ON e.id = ee.episode_id
  WHERE e.season_id = target_season_id
    AND e.id != exclude_episode_id
    AND e.deleted_at IS NULL
    AND e.story_data->>'fullStory' IS NOT NULL
    AND 1 - (ee.premise_embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- Function to search for relevant characters based on description
CREATE OR REPLACE FUNCTION search_relevant_characters(
  query_embedding VECTOR(1024),
  target_project_id UUID,
  exclude_character_ids UUID[] DEFAULT ARRAY[]::UUID[],
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  character_id UUID,
  name VARCHAR,
  description TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.name,
    a.description,
    1 - (ce.description_embedding <=> query_embedding) as similarity
  FROM assets a
  INNER JOIN character_embeddings ce ON a.id = ce.character_id
  WHERE a.project_id = target_project_id
    AND a.type = 'character'
    AND a.deleted_at IS NULL
    AND NOT (a.id = ANY(exclude_character_ids))
    AND 1 - (ce.description_embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- Trigger function to notify when embeddings need to be generated
CREATE OR REPLACE FUNCTION trigger_generate_episode_embeddings()
RETURNS TRIGGER AS $$
BEGIN
  -- Queue async job to generate embeddings via pg_notify
  -- Background worker will listen for this notification
  PERFORM pg_notify(
    'generate_embedding',
    json_build_object(
      'table', 'episodes',
      'id', NEW.id,
      'premise', NEW.story_data->>'premise',
      'story', SUBSTRING(NEW.story_data->>'fullStory', 1, 2000)
    )::text
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate embeddings when story is updated
CREATE TRIGGER episode_embedding_trigger
AFTER INSERT OR UPDATE OF story_data ON episodes
FOR EACH ROW
WHEN (NEW.story_data->>'fullStory' IS NOT NULL)
EXECUTE FUNCTION trigger_generate_episode_embeddings();

-- Comments for documentation
COMMENT ON TABLE episode_embeddings IS 'Voyage-large-2 embeddings for semantic episode search';
COMMENT ON TABLE character_embeddings IS 'Voyage-large-2 embeddings for semantic character discovery';
COMMENT ON FUNCTION search_similar_episodes IS 'Find thematically similar episodes using semantic search';
COMMENT ON FUNCTION search_relevant_characters IS 'Discover relevant characters via semantic search';
