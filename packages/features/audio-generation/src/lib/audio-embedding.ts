/**
 * Audio Embedding Utilities
 * 
 * Generate and match embeddings for audio asset semantic search.
 * Uses OpenAI text-embedding-3-small for 1536-dimension vectors.
 */

import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// =============================================================================
// Types
// =============================================================================

export interface SemanticMatch {
    id: string;
    similarity: number;
    prompt: string;
    fileUrl: string | null;
    audioType: string;
    name: string | null;
}

// =============================================================================
// Embedding Generation
// =============================================================================

/**
 * Generate embedding for a text prompt using OpenAI
 */
export async function generateAudioEmbedding(prompt: string): Promise<number[] | null> {
    const logger = await getLogger();

    // Get OpenAI API key from environment
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        logger.warn({ name: 'audio.embedding' }, 'OpenAI API key not configured, skipping embedding generation');
        return null;
    }

    try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'text-embedding-3-small',
                input: prompt,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            logger.error({ name: 'audio.embedding', error }, 'Failed to generate embedding');
            return null;
        }

        const data = await response.json() as {
            data: Array<{ embedding: number[] }>;
        };

        return data.data[0]?.embedding ?? null;
    } catch (error) {
        logger.error({ name: 'audio.embedding', error }, 'Embedding generation error');
        return null;
    }
}

/**
 * Save embedding for an audio asset
 */
export async function saveAudioAssetEmbedding(
    assetId: string,
    embedding: number[],
): Promise<void> {
    const logger = await getLogger();
    const client = getSupabaseServerClient();

    // Format embedding as pgvector format
    const embeddingStr = `[${embedding.join(',')}]`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (client as any)
        .from('audio_assets')
        .update({ embedding: embeddingStr })
        .eq('id', assetId);

    if (error) {
        logger.error({ name: 'audio.embedding', assetId, error }, 'Failed to save embedding');
    } else {
        logger.info({ name: 'audio.embedding', assetId }, 'Embedding saved');
    }
}

// =============================================================================
// Semantic Matching
// =============================================================================

/**
 * Find semantically similar audio assets using vector similarity
 * Returns matches above the threshold (0.4 = moderately strict)
 */
export async function findSemanticAudioMatches(
    projectId: string,
    prompt: string,
    options: {
        threshold?: number;
        limit?: number;
        audioType?: 'music' | 'sfx' | 'ambient';
    } = {},
): Promise<SemanticMatch[]> {
    const logger = await getLogger();
    const { threshold = 0.4, limit = 5 } = options;

    // Generate embedding for the query prompt
    const embedding = await generateAudioEmbedding(prompt);
    if (!embedding) {
        logger.warn({ name: 'audio.semantic' }, 'Could not generate embedding for semantic search');
        return [];
    }

    const client = getSupabaseServerClient();

    // Call the RPC function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (client as any).rpc('match_audio_assets', {
        query_embedding: `[${embedding.join(',')}]`,
        match_threshold: threshold,
        match_count: limit,
        p_project_id: projectId,
    });

    if (error) {
        logger.error({ name: 'audio.semantic', error }, 'Semantic search failed');
        return [];
    }

    const matches = (data ?? []) as Array<{
        id: string;
        similarity: number;
        prompt: string;
        file_url: string | null;
        audio_type: string;
        name: string | null;
    }>;

    logger.info(
        { name: 'audio.semantic', projectId, matchCount: matches.length, threshold },
        'Semantic search completed',
    );

    return matches.map(m => ({
        id: m.id,
        similarity: m.similarity,
        prompt: m.prompt,
        fileUrl: m.file_url,
        audioType: m.audio_type,
        name: m.name,
    }));
}

/**
 * Find best match above threshold, or null if none found
 */
export async function findBestSemanticMatch(
    projectId: string,
    prompt: string,
    threshold = 0.4,
): Promise<SemanticMatch | null> {
    const matches = await findSemanticAudioMatches(projectId, prompt, {
        threshold,
        limit: 1,
    });

    return matches[0] ?? null;
}
