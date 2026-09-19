import 'server-only';

/**
 * Voyage AI Client for generating embeddings
 * Uses Voyage-large-2 model for 1024-dimensional embeddings
 */

interface VoyageEmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage: {
    total_tokens: number;
  };
}

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-large-2';

if (!VOYAGE_API_KEY) {
  console.warn(
    '[Voyage] VOYAGE_API_KEY not set. Semantic search will not be available.',
  );
}

/**
 * Generate embedding for a document
 * Use this for indexing content (episodes, characters, etc.)
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!VOYAGE_API_KEY) {
    throw new Error('VOYAGE_API_KEY is not configured');
  }

  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: [text],
      model: VOYAGE_MODEL,
      input_type: 'document',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage API error: ${error}`);
  }

  const data: VoyageEmbeddingResponse = await response.json();
  return data.embeddings[0] ?? [];
}

/**
 * Generate embedding for a search query
 * Use this for finding similar content
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  if (!VOYAGE_API_KEY) {
    throw new Error('VOYAGE_API_KEY is not configured');
  }

  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: [query],
      model: VOYAGE_MODEL,
      input_type: 'query',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage API error: ${error}`);
  }

  const data: VoyageEmbeddingResponse = await response.json();
  return data.embeddings[0] ?? [];
}

/**
 * Index an episode's premise and story for semantic search
 */
export async function indexEpisode(
  episodeId: string,
  premise: string,
  story: string,
): Promise<void> {
  if (!VOYAGE_API_KEY) {
    console.warn('[Voyage] Skipping episode indexing - API key not configured');
    return;
  }

  // Admin client, not the cookie-scoped one. Every caller here is a
  // background worker with no user session — indexing runs from the
  // llm-worker Lambda — so the request-scoped client has no identity to
  // act as. It previously worked only because these tables had RLS
  // disabled; now that they do not, it needs the service role.
  const { getSupabaseServerAdminClient } = await import(
    '@kit/supabase/server-admin-client'
  );
  const supabase = getSupabaseServerAdminClient();

  try {
    // Generate embeddings for premise and story summary
    const [premiseEmb, storyEmb] = await Promise.all([
      generateEmbedding(premise),
      generateEmbedding(story.substring(0, 2000)), // First 2000 chars
    ]);

    // Upsert embeddings into database
    const { error } = await (supabase as any)
      .from('episode_embeddings')
      .upsert({
        episode_id: episodeId,
        premise_embedding: premiseEmb,
        story_embedding: storyEmb,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      console.error('[Voyage] Failed to index episode:', error);
      throw error;
    }

    console.log('[Voyage] Successfully indexed episode:', episodeId);
  } catch (error) {
    console.error('[Voyage] Error indexing episode:', error);
    throw error;
  }
}

/**
 * Search for similar episodes using semantic search
 */
export async function searchSimilarEpisodes(params: {
  query: string;
  seasonId: string;
  excludeId: string;
  limit: number;
  threshold?: number;
}): Promise<
  Array<{
    episode_id: string;
    number: number;
    title: string;
    story_summary: string;
    similarity: number;
  }>
> {
  if (!VOYAGE_API_KEY) {
    console.warn(
      '[Voyage] Semantic search unavailable - falling back to sequential episodes',
    );
    return [];
  }

  // Admin client, not the cookie-scoped one. Every caller here is a
  // background worker with no user session — indexing runs from the
  // llm-worker Lambda — so the request-scoped client has no identity to
  // act as. It previously worked only because these tables had RLS
  // disabled; now that they do not, it needs the service role.
  const { getSupabaseServerAdminClient } = await import(
    '@kit/supabase/server-admin-client'
  );
  const supabase = getSupabaseServerAdminClient();

  try {
    const queryEmbedding = await generateQueryEmbedding(params.query);

    const { data, error } = await (supabase as any).rpc(
      'search_similar_episodes',
      {
        query_embedding: queryEmbedding,
        target_season_id: params.seasonId,
        exclude_episode_id: params.excludeId,
        match_threshold: params.threshold ?? 0.75,
        match_count: params.limit,
      },
    );

    if (error) {
      console.error('[Voyage] Error searching episodes:', error);
      return [];
    }

    return (data as any) ?? [];
  } catch (error) {
    console.error('[Voyage] Error in semantic search:', error);
    return [];
  }
}

/**
 * Search for relevant characters using semantic search
 */
export async function searchRelevantCharacters(params: {
  query: string;
  projectId: string;
  excludeIds: string[];
  limit: number;
  threshold?: number;
}): Promise<
  Array<{
    character_id: string;
    name: string;
    description: string;
    similarity: number;
  }>
> {
  if (!VOYAGE_API_KEY) {
    console.warn('[Voyage] Character discovery unavailable');
    return [];
  }

  // Admin client, not the cookie-scoped one. Every caller here is a
  // background worker with no user session — indexing runs from the
  // llm-worker Lambda — so the request-scoped client has no identity to
  // act as. It previously worked only because these tables had RLS
  // disabled; now that they do not, it needs the service role.
  const { getSupabaseServerAdminClient } = await import(
    '@kit/supabase/server-admin-client'
  );
  const supabase = getSupabaseServerAdminClient();

  try {
    const queryEmbedding = await generateQueryEmbedding(params.query);

    const { data, error } = await (supabase as any).rpc(
      'search_relevant_characters',
      {
        query_embedding: queryEmbedding,
        target_project_id: params.projectId,
        exclude_character_ids: params.excludeIds,
        match_threshold: params.threshold ?? 0.7,
        match_count: params.limit,
      },
    );

    if (error) {
      console.error('[Voyage] Error searching characters:', error);
      return [];
    }

    return (data as any) ?? [];
  } catch (error) {
    console.error('[Voyage] Error in character discovery:', error);
    return [];
  }
}
