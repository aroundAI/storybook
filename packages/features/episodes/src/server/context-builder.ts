

import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Episode context for story generation prompts
 * Contains all necessary information to ensure consistency across the production pipeline
 */
export interface EpisodeContext {
    // Episode-specific
    premise: string;
    episodeNumber: number;
    seasonNumber?: number;

    // Tagged assets (from episode metadata)
    characters: Array<{
        id: string;
        name: string;
        role: string;
        description: string;
        personality?: string;
    }>;

    locations: Array<{
        id: string;
        name: string;
        setting: string;
        description: string;
        atmosphere?: string;
    }>;

    // Season context
    seasonPremise?: string;
    seasonTheme?: string;

    // Continuity (previous episodes)
    previousEpisodes: Array<{
        number: number;
        title: string;
        summary: string;
    }>;

    // Project constraints
    genre: string;
    targetAudience: string;
    visualStyle: string;
}

/**
 * Build rich context for episode story generation
 * Fetches characters, locations, season arc, and previous episodes
 *
 * @param episodeId - UUID of the episode
 * @param useSemanticSearch - Whether to use semantic search for previous episodes (Phase 2.5)
 * @returns Complete episode context for prompt injection
 */
export async function buildEpisodeContext(
    episodeId: string,
    useSemanticSearch: boolean = false,
): Promise<EpisodeContext> {
    const client = getSupabaseServerClient();

    // 1. Fetch episode with project metadata
    const { data: episode, error: episodeError } = await client
        .from('episodes')
        .select(
            `
      id,
      number,
      title,
      description,
      story_data,
      metadata,
      season_id,
      project:projects (
        id,
        metadata
      ),
      season:seasons (
        id,
        number,
        name,
        description
      )
    `,
        )
        .eq('id', episodeId)
        .is('deleted_at', null)
        .single();

    if (episodeError || !episode) {
        throw new Error(`Episode not found: ${episodeId}`);
    }

    const metadata = (episode.metadata as { character_ids?: string[]; location_ids?: string[]; season_premise?: string }) ?? {};
    const storyData = (episode.story_data as { premise?: string }) ?? {};
    const projectMetadata = (episode.project?.metadata as { genre?: string; targetAudience?: string; videoStyle?: string }) ?? {};

    // 2. Fetch tagged characters
    const characterIds = metadata.character_ids ?? [];
    const characters = await fetchCharactersByIds(characterIds);

    // 3. Fetch tagged locations
    const locationIds = metadata.location_ids ?? [];
    const locations = await fetchLocationsByIds(locationIds);

    // 4. Fetch season context
    const seasonContext = episode.season
        ? {
            number: episode.season.number,
            premise: episode.season.description ?? metadata.season_premise,
        }
        : null;

    // 5. Fetch previous episodes (semantic or sequential)
    let previousEpisodes: EpisodeContext['previousEpisodes'] = [];

    if (useSemanticSearch && process.env.VOYAGE_API_KEY && episode.season_id) {
        try {
            // Use semantic search to find thematically relevant episodes
            const { searchSimilarEpisodes } = await import(
                '@kit/embeddings/voyage-client'
            );

            const results = await searchSimilarEpisodes({
                query: storyData.premise ?? episode.description ?? '',
                seasonId: episode.season_id,
                excludeId: episodeId,
                limit: 3,
                threshold: 0.75,
            });

            previousEpisodes = results.map((ep) => ({
                number: ep.number,
                title: ep.title,
                summary: ep.story_summary,
            }));
        } catch {
            console.warn('[Context Builder] Semantic search failed, falling back to sequential');
            previousEpisodes = await fetchSequentialEpisodes(
                episode.season_id,
                episode.number,
            );
        }
    } else {
        // Fallback to sequential episodes
        previousEpisodes = await fetchSequentialEpisodes(
            episode.season_id,
            episode.number,
        );
    }

    return {
        premise: storyData.premise ?? episode.description ?? '',
        episodeNumber: episode.number,
        seasonNumber: seasonContext?.number,

        characters,
        locations,

        seasonPremise: seasonContext?.premise,
        seasonTheme: undefined, // TODO: Add theme to season schema

        previousEpisodes,

        genre: projectMetadata.genre ?? 'general',
        targetAudience: projectMetadata.targetAudience ?? 'general',
        visualStyle: projectMetadata.videoStyle ?? 'balanced',
    };
}

/**
 * Fetch character details by IDs
 */
async function fetchCharactersByIds(
    characterIds: string[],
): Promise<EpisodeContext['characters']> {
    if (characterIds.length === 0) return [];

    const client = getSupabaseServerClient();

    const { data, error } = await client
        .from('assets')
        .select(
            `
      id,
      name,
      description,
      metadata
    `,
        )
        .in('id', characterIds)
        .eq('type', 'character');

    if (error) {
        throw new Error(`Failed to fetch characters: ${error.message}`);
    }

    return (data ?? []).map((asset) => {
        const metadata = (asset.metadata as { personality?: string; role?: string }) ?? {};

        return {
            id: asset.id,
            name: asset.name,
            role: metadata.role ?? 'character',
            description: asset.description ?? '',
            personality: metadata.personality,
        };
    });
}

/**
 * Fetch location details by IDs
 */
async function fetchLocationsByIds(
    locationIds: string[],
): Promise<EpisodeContext['locations']> {
    if (locationIds.length === 0) return [];

    const client = getSupabaseServerClient();

    const { data, error } = await client
        .from('assets')
        .select(
            `
      id,
      name,
      description,
      metadata
    `,
        )
        .in('id', locationIds)
        .eq('type', 'location');

    if (error) {
        throw new Error(`Failed to fetch locations: ${error.message}`);
    }

    return (data ?? []).map((asset) => {
        const metadata = (asset.metadata as { setting?: string; atmosphere?: string }) ?? {};

        return {
            id: asset.id,
            name: asset.name,
            setting: metadata.setting ?? 'location',
            description: asset.description ?? '',
            atmosphere: metadata.atmosphere,
        };
    });
}

/**
 * Fetch previous episodes in sequential order
 */
async function fetchSequentialEpisodes(
    seasonId: string | null,
    currentNumber: number,
): Promise<EpisodeContext['previousEpisodes']> {
    if (!seasonId) return [];

    const client = getSupabaseServerClient();

    const { data, error } = await client
        .from('episodes')
        .select('number, title, story_data')
        .eq('season_id', seasonId)
        .lt('number', currentNumber)
        .not('story_data->fullStory', 'is', null)
        .is('deleted_at', null)
        .order('number', { ascending: false })
        .limit(3);

    if (error) {
        throw new Error(`Failed to fetch previous episodes: ${error.message}`);
    }

    return (data ?? []).map((ep) => {
        const storyData = (ep.story_data as { fullStory?: string }) ?? {};
        const fullStory = storyData.fullStory ?? '';

        return {
            number: ep.number,
            title: ep.title,
            summary: fullStory.substring(0, 300), // First 300 chars for continuity
        };
    });
}

/**
 * Format characters for prompt injection
 */
export function formatCharactersForPrompt(
    characters: EpisodeContext['characters'],
): string {
    if (characters.length === 0) return '';

    return `**Characters in This Episode**:\n${characters
        .map(
            (c) =>
                `- **${c.name}** (${c.role}): ${c.description}${c.personality ? `\n  Personality: ${c.personality}` : ''}`,
        )
        .join('\n')}`;
}

/**
 * Format locations for prompt injection
 */
export function formatLocationsForPrompt(
    locations: EpisodeContext['locations'],
): string {
    if (locations.length === 0) return '';

    return `**Locations**:\n${locations
        .map(
            (l) =>
                `- **${l.name}** (${l.setting}): ${l.description}${l.atmosphere ? `\n  Atmosphere: ${l.atmosphere}` : ''}`,
        )
        .join('\n')}`;
}

/**
 * Format previous episodes for prompt injection
 */
export function formatPreviousEpisodesForPrompt(
    episodes: EpisodeContext['previousEpisodes'],
): string {
    if (episodes.length === 0) return '';

    return `**Previous Episodes (for continuity)**:\n${episodes
        .map(
            (ep) =>
                `- Episode ${ep.number}: "${ep.title}"\n  Summary: ${ep.summary}...`,
        )
        .join('\n\n')}`;
}
