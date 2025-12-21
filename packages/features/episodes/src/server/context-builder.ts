import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { StoryData } from '../lib/types';

/**
 * Physical attributes for VEO 3.1 character descriptions (15+ attributes)
 */
export interface VeoPhysicalAttributes {
  age?: number;
  ageRange?: string;
  gender?: string;
  ethnicity?: string;
  height?: string;
  build?: string;
  hairColor?: string;
  hairStyle?: string;
  eyeColor?: string;
  skinTone?: string;
  distinctiveFeatures?: string[];
  facialHair?: string;
}

/**
 * Clothing style for VEO 3.1 consistency
 */
export interface VeoClothingStyle {
  defaultOutfit?: string;
  style?: string;
  colors?: string[];
  accessories?: string[];
}

/**
 * Episode context for story generation prompts
 * Contains all necessary information to ensure consistency across the production pipeline
 */
export interface EpisodeContext {
  // Episode-specific
  premise: string;
  episodeNumber: number;
  seasonNumber?: number;

  // Tagged assets (from episode metadata) - Enhanced with VEO 3.1 fields
  characters: Array<{
    id: string;
    name: string;
    role: string;
    description: string;
    personality?: string;
    // VEO 3.1 Enhanced Fields
    imageUrl?: string; // Reference image for VEO "Ingredients"
    thumbnailUrl?: string;
    physicalAttributes?: VeoPhysicalAttributes;
    clothingStyle?: VeoClothingStyle;
    elementPrompt?: string; // Pre-generated character prompt
  }>;

  locations: Array<{
    id: string;
    name: string;
    setting: string;
    description: string;
    atmosphere?: string;
    // VEO 3.1 Enhanced Fields
    imageUrl?: string; // Reference image for VEO "Ingredients"
    thumbnailUrl?: string;
    timeOfDay?: string;
    weather?: string;
  }>;

  // Season context
  seasonPremise?: string;
  seasonTheme?: string;

  // Continuity (previous episodes) - SCORE Framework
  previousEpisodes: Array<{
    number: number;
    title: string;
    summary: string;
    sentimentScore?: number;
    keyEvents?: string[];
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

  const metadata =
    (episode.metadata as {
      character_ids?: string[];
      location_ids?: string[];
      season_premise?: string;
    }) ?? {};
  const storyData = (episode.story_data as { premise?: string }) ?? {};
  const projectMetadata =
    (episode.project?.metadata as {
      genre?: string;
      targetAudience?: string;
      videoStyle?: string;
    }) ?? {};

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
      console.warn(
        '[Context Builder] Semantic search failed, falling back to sequential',
      );
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
 * Character metadata interface for assets table
 */
interface CharacterMetadata {
  personality?: string;
  role?: string;
  physicalAttributes?: VeoPhysicalAttributes;
  clothingStyle?: VeoClothingStyle;
  elementPrompt?: string;
}

/**
 * Fetch character details by IDs with VEO 3.1 enhanced fields
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
      file_url,
      thumbnail_url,
      metadata
    `,
    )
    .in('id', characterIds)
    .eq('type', 'character');

  if (error) {
    throw new Error(`Failed to fetch characters: ${error.message}`);
  }

  return (data ?? []).map((asset) => {
    const metadata = (asset.metadata as CharacterMetadata) ?? {};

    return {
      id: asset.id,
      name: asset.name,
      role: metadata.role ?? 'character',
      description: asset.description ?? '',
      personality: metadata.personality,
      // VEO 3.1 Enhanced Fields
      imageUrl: asset.file_url ?? undefined,
      thumbnailUrl: asset.thumbnail_url ?? undefined,
      physicalAttributes: metadata.physicalAttributes,
      clothingStyle: metadata.clothingStyle,
      elementPrompt: metadata.elementPrompt,
    };
  });
}

/**
 * Location metadata interface for assets table
 */
interface LocationMetadata {
  setting?: string;
  atmosphere?: string;
  timeOfDay?: string;
  weather?: string;
  lighting?: string;
  architecture?: string;
}

/**
 * Fetch location details by IDs with VEO 3.1 enhanced fields
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
      file_url,
      thumbnail_url,
      metadata
    `,
    )
    .in('id', locationIds)
    .eq('type', 'location');

  if (error) {
    throw new Error(`Failed to fetch locations: ${error.message}`);
  }

  return (data ?? []).map((asset) => {
    const metadata = (asset.metadata as LocationMetadata) ?? {};

    return {
      id: asset.id,
      name: asset.name,
      setting: metadata.setting ?? 'location',
      description: asset.description ?? '',
      atmosphere: metadata.atmosphere,
      // VEO 3.1 Enhanced Fields
      imageUrl: asset.file_url ?? undefined,
      thumbnailUrl: asset.thumbnail_url ?? undefined,
      timeOfDay: metadata.timeOfDay,
      weather: metadata.weather,
    };
  });
}

/**
 * Build a plot-focused summary from story data
 * Uses SCORE episodeSummary field (required for new episodes)
 */
function buildPlotSummary(storyData: StoryData | null): string {
  if (!storyData?.episodeSummary) return '';
  return storyData.episodeSummary;
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
    const storyData = ep.story_data as StoryData | null;

    return {
      number: ep.number,
      title: ep.title,
      summary: buildPlotSummary(storyData),
      sentimentScore: storyData?.sentimentScore,
      keyEvents: storyData?.keyEvents,
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
 * SCORE Framework: Includes plot summary and key events for continuity
 */
export function formatPreviousEpisodesForPrompt(
  episodes: EpisodeContext['previousEpisodes'],
): string {
  if (episodes.length === 0) return '';

  return `**Previous Episodes (for continuity)**:
${episodes
  .map((ep) => {
    let entry = `- Episode ${ep.number}: "${ep.title}"
  Plot: ${ep.summary}`;

    if (ep.keyEvents && ep.keyEvents.length > 0) {
      entry += `\n  Key Events: ${ep.keyEvents.join('; ')}`;
    }

    return entry;
  })
  .join('\n\n')}

**Continuity Guidelines**:
- Reference events/characters from previous episodes where natural
- Maintain character development arcs
- Build on key events from prior episodes
- Acknowledge established relationships and dynamics`;
}

// =============================================================================
// VEO 3.1 Enhanced Formatting Functions
// =============================================================================

/**
 * Format a single character for VEO 3.1 prompts with 15+ physical attributes
 * Follows the VEO 3.1 best practice of detailed character descriptions
 */
export function formatCharacterForVeoPrompt(
  character: EpisodeContext['characters'][0],
): string {
  const parts: string[] = [];

  // Start with base description
  if (character.description) {
    parts.push(character.description);
  }

  // Add physical attributes if available
  const attrs = character.physicalAttributes;
  if (attrs) {
    const physicalParts: string[] = [];

    if (attrs.age || attrs.ageRange) {
      physicalParts.push(
        attrs.age ? `${attrs.age}-year-old` : (attrs.ageRange ?? ''),
      );
    }
    if (attrs.ethnicity) physicalParts.push(attrs.ethnicity);
    if (attrs.gender) physicalParts.push(attrs.gender);
    if (attrs.build) physicalParts.push(`${attrs.build} build`);
    if (attrs.height) physicalParts.push(attrs.height);
    if (attrs.hairColor && attrs.hairStyle) {
      physicalParts.push(`${attrs.hairColor} ${attrs.hairStyle} hair`);
    } else if (attrs.hairColor) {
      physicalParts.push(`${attrs.hairColor} hair`);
    }
    if (attrs.eyeColor) physicalParts.push(`${attrs.eyeColor} eyes`);
    if (attrs.skinTone) physicalParts.push(`${attrs.skinTone} skin tone`);
    if (attrs.facialHair) physicalParts.push(attrs.facialHair);
    if (attrs.distinctiveFeatures && attrs.distinctiveFeatures.length > 0) {
      physicalParts.push(attrs.distinctiveFeatures.join(', '));
    }

    if (physicalParts.length > 0) {
      parts.push(physicalParts.join(', '));
    }
  }

  // Add clothing style if available
  const clothing = character.clothingStyle;
  if (clothing) {
    const clothingParts: string[] = [];

    if (clothing.defaultOutfit) {
      clothingParts.push(`wearing ${clothing.defaultOutfit}`);
    }
    if (clothing.style) {
      clothingParts.push(clothing.style);
    }
    if (clothing.colors && clothing.colors.length > 0) {
      clothingParts.push(`in ${clothing.colors.join(' and ')} colors`);
    }
    if (clothing.accessories && clothing.accessories.length > 0) {
      clothingParts.push(`with ${clothing.accessories.join(', ')}`);
    }

    if (clothingParts.length > 0) {
      parts.push(clothingParts.join(', '));
    }
  }

  // Add personality traits for expression/mannerism cues
  if (character.personality) {
    parts.push(`personality: ${character.personality}`);
  }

  return parts.join('. ');
}

/**
 * Format all characters for VEO 3.1 shot generation prompt
 * Returns detailed character descriptions optimized for video generation
 */
export function formatCharactersForVeoPrompt(
  characters: EpisodeContext['characters'],
): string {
  if (characters.length === 0) return '';

  return `## VEO 3.1 Character Descriptions (15+ attributes each)

${characters
  .map((c) => {
    const hasImage = !!c.imageUrl;
    const imageNote = hasImage
      ? `\n  📷 Reference Image: ${c.imageUrl}`
      : '\n  ⚠️ No reference image available';

    return `### ${c.name} (${c.role})
${formatCharacterForVeoPrompt(c)}${imageNote}`;
  })
  .join('\n\n')}`;
}

/**
 * Format a single location for VEO 3.1 prompts
 * Includes environment, atmosphere, lighting, and spatial details
 */
export function formatLocationForVeoPrompt(
  location: EpisodeContext['locations'][0],
): string {
  const parts: string[] = [];

  // Base description
  if (location.description) {
    parts.push(location.description);
  }

  // Setting type
  if (location.setting && location.setting !== 'location') {
    parts.push(`Setting: ${location.setting}`);
  }

  // Atmosphere
  if (location.atmosphere) {
    parts.push(`Atmosphere: ${location.atmosphere}`);
  }

  // Time of day (important for lighting)
  if (location.timeOfDay) {
    parts.push(`Time: ${location.timeOfDay}`);
  }

  // Weather conditions
  if (location.weather) {
    parts.push(`Weather: ${location.weather}`);
  }

  return parts.join('. ');
}

/**
 * Format all locations for VEO 3.1 shot generation prompt
 * Returns detailed location descriptions optimized for video generation
 */
export function formatLocationsForVeoPrompt(
  locations: EpisodeContext['locations'],
): string {
  if (locations.length === 0) return '';

  return `## VEO 3.1 Location Descriptions

${locations
  .map((l) => {
    const hasImage = !!l.imageUrl;
    const imageNote = hasImage
      ? `\n  📷 Reference Image: ${l.imageUrl}`
      : '\n  ⚠️ No reference image available';

    return `### ${l.name}
${formatLocationForVeoPrompt(l)}${imageNote}`;
  })
  .join('\n\n')}`;
}

/**
 * Extract reference images from characters and locations for VEO 3.1 "Ingredients"
 * Returns structured data for shot-level reference image inclusion
 */
export function extractReferenceImages(context: EpisodeContext): {
  characters: Array<{ name: string; url: string }>;
  locations: Array<{ name: string; url: string }>;
  missingCharacters: string[];
  missingLocations: string[];
} {
  const result = {
    characters: [] as Array<{ name: string; url: string }>,
    locations: [] as Array<{ name: string; url: string }>,
    missingCharacters: [] as string[],
    missingLocations: [] as string[],
  };

  for (const character of context.characters) {
    if (character.imageUrl) {
      result.characters.push({
        name: character.name,
        url: character.imageUrl,
      });
    } else {
      result.missingCharacters.push(character.name);
    }
  }

  for (const location of context.locations) {
    if (location.imageUrl) {
      result.locations.push({
        name: location.name,
        url: location.imageUrl,
      });
    } else {
      result.missingLocations.push(location.name);
    }
  }

  return result;
}

/**
 * Build VEO 3.1 negative prompt based on project settings
 * Prevents common video generation issues
 */
export function buildVeoNegativePrompt(): string {
  return [
    'subtitles',
    'captions',
    'watermark',
    'text overlays',
    'logo',
    'poor lighting',
    'blurry',
    'distorted hands',
    'extra fingers',
    'deformed face',
    'cartoon effects',
    'anime style',
    'low quality',
    'compression artifacts',
    'noise',
    'grain',
  ].join(', ');
}

// =============================================================================
// Scene-by-Scene Shot List Generation Context
// =============================================================================

/**
 * Character registry entry for global shot context
 */
export interface CharacterRegistryEntry {
  name: string;
  veoDescription: string;
  referenceImageUrl: string | null;
  role: string;
  personality?: string;
}

/**
 * Location registry entry for global shot context
 */
export interface LocationRegistryEntry {
  name: string;
  veoDescription: string;
  referenceImageUrl: string | null;
  atmosphere?: string;
}

/**
 * Episode metadata for shot generation
 */
export interface ShotGenerationEpisodeMetadata {
  title: string;
  genre: string;
  tone: string;
  targetAudience: string;
  visualStyle: string;
  defaultNegativePrompt: string;
}

/**
 * Global context for scene-by-scene shot generation
 * Extracted ONCE and filtered per scene
 */
export interface GlobalShotContext {
  characterRegistry: CharacterRegistryEntry[];
  locationRegistry: LocationRegistryEntry[];
  episodeMetadata: ShotGenerationEpisodeMetadata;
  referenceImages: {
    characters: Array<{ name: string; url: string }>;
    locations: Array<{ name: string; url: string }>;
    missingCharacters: string[];
    missingLocations: string[];
  };
  episode: {
    id: string;
    title: string;
  };
}

/**
 * Filtered context for a specific scene
 * Contains only characters/locations appearing in that scene
 */
export interface SceneFilteredContext {
  characters: CharacterRegistryEntry[];
  locations: LocationRegistryEntry[];
  referenceImages: {
    characters: Array<{ name: string; url: string }>;
    locations: Array<{ name: string; url: string }>;
  };
  episodeMetadata: ShotGenerationEpisodeMetadata;
}

/**
 * Build global context for scene-by-scene shot generation
 * This context is extracted ONCE and filtered per scene for efficiency
 *
 * @param episodeId - UUID of the episode
 * @returns Complete global context with character/location registries
 */
export async function buildGlobalShotContext(
  episodeId: string,
): Promise<GlobalShotContext> {
  const client = getSupabaseServerClient();

  // 1. Fetch episode with project metadata
  const { data: episode, error: episodeError } = await client
    .from('episodes')
    .select(
      `
      id,
      title,
      story_data,
      metadata,
      project:projects (
        id,
        metadata
      )
    `,
    )
    .eq('id', episodeId)
    .is('deleted_at', null)
    .single();

  if (episodeError || !episode) {
    throw new Error(`Episode not found: ${episodeId}`);
  }

  const metadata =
    (episode.metadata as {
      character_ids?: string[];
      location_ids?: string[];
    }) ?? {};
  const storyData = (episode.story_data as { tone?: string }) ?? {};
  const projectMetadata =
    (episode.project?.metadata as {
      genre?: string;
      targetAudience?: string;
      videoStyle?: string;
    }) ?? {};

  // 2. Fetch tagged characters
  const characterIds = metadata.character_ids ?? [];
  const characters = await fetchCharactersByIds(characterIds);

  // 3. Fetch tagged locations
  const locationIds = metadata.location_ids ?? [];
  const locations = await fetchLocationsByIds(locationIds);

  // 4. Build character registry with VEO descriptions
  const characterRegistry: CharacterRegistryEntry[] = characters.map(
    (char) => ({
      name: char.name,
      veoDescription: formatCharacterForVeoPrompt(char),
      referenceImageUrl: char.imageUrl ?? char.thumbnailUrl ?? null,
      role: char.role,
      personality: char.personality,
    }),
  );

  // 5. Build location registry with VEO descriptions
  const locationRegistry: LocationRegistryEntry[] = locations.map((loc) => ({
    name: loc.name,
    veoDescription: formatLocationForVeoPrompt(loc),
    referenceImageUrl: loc.imageUrl ?? loc.thumbnailUrl ?? null,
    atmosphere: loc.atmosphere,
  }));

  // 6. Build episode metadata
  const episodeMetadata: ShotGenerationEpisodeMetadata = {
    title: episode.title,
    genre: projectMetadata.genre ?? 'drama',
    tone: storyData.tone ?? 'cinematic',
    targetAudience: projectMetadata.targetAudience ?? 'general',
    visualStyle: projectMetadata.videoStyle ?? 'cinematic, 35mm film aesthetic',
    defaultNegativePrompt: buildVeoNegativePrompt(),
  };

  // 7. Extract reference images
  const referenceImages = {
    characters: characters
      .filter((c) => c.imageUrl)
      .map((c) => ({ name: c.name, url: c.imageUrl! })),
    locations: locations
      .filter((l) => l.imageUrl)
      .map((l) => ({ name: l.name, url: l.imageUrl! })),
    missingCharacters: characters.filter((c) => !c.imageUrl).map((c) => c.name),
    missingLocations: locations.filter((l) => !l.imageUrl).map((l) => l.name),
  };

  return {
    characterRegistry,
    locationRegistry,
    episodeMetadata,
    referenceImages,
    episode: {
      id: episode.id,
      title: episode.title,
    },
  };
}

/**
 * Extract unique character names appearing in a scene
 * Characters are identified from dialogue lines
 *
 * @param scene - Screenplay scene with dialogue
 * @returns Array of unique character names (normalized)
 */
export function extractSceneCharacters(scene: {
  dialogue: Array<{ character: string }>;
}): string[] {
  const characters = new Set<string>();

  for (const line of scene.dialogue) {
    // Normalize character name for matching
    characters.add(line.character.trim());
  }

  return Array.from(characters);
}

/**
 * Extract location name from scene
 * Returns normalized location name for registry lookup
 *
 * @param scene - Screenplay scene with location
 * @returns Normalized location name
 */
export function extractSceneLocation(scene: { location: string }): string {
  return scene.location.trim();
}

/**
 * Filter global context to only include scene-relevant entities
 * Reduces token usage by 50-80% per scene
 *
 * @param scene - Screenplay scene to filter for
 * @param globalContext - Full global context with all characters/locations
 * @returns Filtered context with only scene-relevant entities
 */
export function filterContextForScene(
  scene: { dialogue: Array<{ character: string }>; location: string },
  globalContext: GlobalShotContext,
): SceneFilteredContext {
  const sceneCharacterNames = extractSceneCharacters(scene);
  const sceneLocationName = extractSceneLocation(scene);

  // Filter character registry - case-insensitive matching
  const characters = globalContext.characterRegistry.filter((char) =>
    sceneCharacterNames.some(
      (name) => name.toLowerCase() === char.name.toLowerCase(),
    ),
  );

  // Filter location registry - fuzzy match on location name
  // Match if registry name contains scene location or vice versa
  const locations = globalContext.locationRegistry.filter(
    (loc) =>
      sceneLocationName.toLowerCase().includes(loc.name.toLowerCase()) ||
      loc.name.toLowerCase().includes(sceneLocationName.toLowerCase()),
  );

  // Filter reference images to match
  const characterImages = globalContext.referenceImages.characters.filter(
    (img) =>
      sceneCharacterNames.some(
        (name) => name.toLowerCase() === img.name.toLowerCase(),
      ),
  );

  const locationImages = globalContext.referenceImages.locations.filter(
    (img) =>
      sceneLocationName.toLowerCase().includes(img.name.toLowerCase()) ||
      img.name.toLowerCase().includes(sceneLocationName.toLowerCase()),
  );

  return {
    characters,
    locations,
    referenceImages: {
      characters: characterImages,
      locations: locationImages,
    },
    // Keep episode metadata unfiltered (always needed)
    episodeMetadata: globalContext.episodeMetadata,
  };
}

/**
 * Format a single screenplay scene for the LLM prompt
 * Includes heading, description, and dialogue in standard screenplay format
 *
 * @param scene - Screenplay scene to format
 * @returns Formatted scene text for prompt injection
 */
export function formatSceneForPrompt(scene: {
  number: number;
  heading?: string;
  location: string;
  timeOfDay?: string;
  description: string;
  dialogue: Array<{
    character: string;
    text: string;
    parenthetical?: string;
  }>;
}): string {
  const timeOfDay = scene.timeOfDay?.toUpperCase() ?? 'DAY';
  let text = `${scene.heading ?? `INT./EXT. ${scene.location.toUpperCase()} - ${timeOfDay}`}\n\n`;

  text += `${scene.description}\n\n`;

  for (const line of scene.dialogue) {
    text += `${line.character.toUpperCase()}\n`;
    if (line.parenthetical) {
      text += `(${line.parenthetical})\n`;
    }
    text += `${line.text}\n\n`;
  }

  return text;
}

/**
 * Format filtered character registry for prompt
 * Handles edge cases when characters are not in registry
 *
 * @param sceneContext - Filtered scene context
 * @param dialogueCharacters - Character names from dialogue (for fallback)
 * @returns Formatted character text for prompt
 */
export function formatFilteredCharactersForPrompt(
  sceneContext: SceneFilteredContext,
  dialogueCharacters: string[],
): string {
  if (sceneContext.characters.length > 0) {
    return sceneContext.characters
      .map(
        (c) =>
          `### ${c.name}\n${c.veoDescription}\nReference: ${c.referenceImageUrl ?? '⚠️ No image'}\n`,
      )
      .join('\n');
  }

  // Fallback when characters not in registry
  return `No registered characters in this scene. Characters appearing: ${dialogueCharacters.join(', ') || 'None (action only)'}`;
}

/**
 * Format filtered location registry for prompt
 * Handles edge cases when location is not in registry
 *
 * @param sceneContext - Filtered scene context
 * @param sceneLocation - Scene location name (for fallback)
 * @returns Formatted location text for prompt
 */
export function formatFilteredLocationsForPrompt(
  sceneContext: SceneFilteredContext,
  sceneLocation: string,
): string {
  if (sceneContext.locations.length > 0) {
    return sceneContext.locations
      .map(
        (l) =>
          `### ${l.name}\n${l.veoDescription}\nReference: ${l.referenceImageUrl ?? '⚠️ No image'}\n`,
      )
      .join('\n');
  }

  // Fallback when location not in registry
  return `Location: ${sceneLocation} (not in registry - use scene description)`;
}
