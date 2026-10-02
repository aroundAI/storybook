import type { SupabaseClient } from '@supabase/supabase-js';

import { z } from 'zod';

import {
  effectiveMemoryHorizon,
  resolveProjectType,
  sanitizeStrings,
} from '@kit/episodes/lib';
import type { ProjectType } from '@kit/film-studio-schemas/project';
import { whyNoRow } from '@kit/shared/rows';
import type { Database } from '@kit/supabase/database';

import {
  type PreviousEpisode,
  fetchPreviousEpisodes,
} from './previous-episodes';
import { createVoyageEmbedder } from './voyage-embedder';

/** StoryData interface for episode story content */
export interface StoryData {
  fullStory?: string;
  episodeSummary?: string;
  sentimentScore?: number;
  keyEvents?: string[];
  premise?: string;
  synopsis?: string;
  beats?: Array<{ label: string; content: string }>;
  moral?: string;
  signature_line?: string;
  tags?: string[];
}

/**
 * Physical attributes for VEO 3.1 character descriptions (15+ attributes)
 */
export interface VeoPhysicalAttributes {
  rawDescription?: string;
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
  rawDescription?: string;
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
  synopsis?: string;
  episodeNumber: number;
  seasonNumber?: number;

  // Flexible plot structure (extracted from roadmap)
  beats?: Array<{
    label: string;
    content: string;
  }>;
  moral?: string;
  signatureLine?: string;
  tags?: string[];

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
  seasonDirectionNotes?: string;
  seasonTheme?: string;

  // Continuity (previous episodes) - SCORE Framework. The memory horizon's
  // window: the most recent, then related earlier ones (KB-35)
  previousEpisodes: PreviousEpisode[];

  // Project constraints
  genre: string;
  targetAudience: string;
  visualStyle: string;
  aestheticStyle?: string; // Project Aesthetic Style for consistent visual descriptions

  // Recurring story elements (signature scenes, moral messages, etc.)
  recurringElements?: Array<{
    id: string;
    name: string;
    enabled: boolean;
    location?: string;
    purpose?: string;
    placement?: 'beginning' | 'middle' | 'end' | 'throughout';
    dialogueHints?: string;
  }>;

  // Linked verified facts for fact-driven / non-fiction content
  episodeFacts: Array<{
    id: string;
    claim: string;
    simplifiedClaim?: string;
    category?: string;
    sourceCitation?: string;
    sourceTitle?: string;
    confidenceScore?: number;
  }>;

  // Per-episode visual tone override (e.g. stop-motion, 2.5D)
  visualToneOverride?: string;

  // Genre-aware pipeline fields
  projectType?: ProjectType;
  verifiedFacts: Array<{
    id: string;
    claim: string;
    sourceCitation: string;
    category: string;
    confidence: number;
    sourceType: string;
  }>;
}

/**
 * Build rich context for episode story generation
 * Fetches characters, locations, season arc, and previous episodes
 *
 * @param episodeId - UUID of the episode
 * @param supabase - Supabase client instance
 * @returns Complete episode context for prompt injection
 */
export async function buildEpisodeContext(
  episodeId: string,
  supabase: SupabaseClient<Database>,
  options: {
    /** Add earlier episodes similar to `semanticQuery` (KB-35) */
    semanticContext?: boolean;
    semanticQuery?: string;
  } = {},
): Promise<EpisodeContext> {
  const client = supabase;

  // Debug: Verify client is passed
  console.log(`[buildEpisodeContext] Fetching episode ${episodeId}`);
  console.log(`[buildEpisodeContext] Supabase client type: ${typeof client}`);

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
        description,
        direction_notes
      )
    `,
    )
    .eq('id', episodeId)
    .is('deleted_at', null)
    .single()
    // The untyped client types every embed as an array; both are many-to-one
    // (episodes.project_id, episodes.season_id), so PostgREST returns objects.
    .overrideTypes<{
      project: { id: string; metadata: unknown } | null;
      season: {
        id: string;
        number: number;
        name: string;
        description: string | null;
        direction_notes: string | null;
      } | null;
    }>();

  if (episodeError || !episode) {
    console.error(`[buildEpisodeContext] Query failed:`, {
      errorCode: episodeError?.code,
      errorMessage: episodeError?.message,
      errorDetails: episodeError?.details,
      errorHint: episodeError?.hint,
    });
    throw new Error(whyNoRow(episodeError, `Episode not found (${episodeId})`));
  }

  console.log(
    `[buildEpisodeContext] Episode fetched successfully: ${episode.title}`,
  );

  const metadata =
    (episode.metadata as {
      character_ids?: string[];
      character_names?: string[];
      location_ids?: string[];
      season_premise?: string;
      visual_tone?: string;
    }) ?? {};
  const storyData =
    (episode.story_data as {
      premise?: string;
      synopsis?: string;
      beats?: Array<{ label: string; content: string }>;
      moral?: string;
      signature_line?: string;
      tags?: string[];
    }) ?? {};
  const projectMetadata =
    (episode.project?.metadata as {
      genre?: string;
      targetAudience?: string;
      videoStyle?: string;
      projectType?: ProjectType;
      projectAestheticStyle?: string;
      recurringElements?: Array<{
        id?: string;
        name?: string;
        enabled?: boolean;
        location?: string;
        purpose?: string;
        placement?: 'beginning' | 'middle' | 'end' | 'throughout';
        dialogueHints?: string;
      }>;
      recurringElement?: {
        enabled?: boolean;
        location?: string;
        purpose?: string;
        placement?: 'beginning' | 'middle' | 'end' | 'throughout';
        dialogueHints?: string;
      };
    }) ?? {};

  // 2. Fetch tagged characters (expand "All Characters" wildcard)
  const characterIds = metadata.character_ids ?? [];
  const characterNames = metadata.character_names ?? [];
  const hasAllCharactersWildcard = characterNames.some(
    (name) => name.toLowerCase() === 'all characters',
  );

  let characters: EpisodeContext['characters'];

  if (hasAllCharactersWildcard && episode.project?.id) {
    console.log(
      `[buildEpisodeContext] "All Characters" wildcard detected — fetching all project characters`,
    );
    characters = await fetchAllProjectCharacters(episode.project.id, supabase);
  } else {
    characters = await fetchCharactersByIds(characterIds, supabase);
  }

  // 3. Fetch tagged locations
  const locationIds = metadata.location_ids ?? [];
  const locations = await fetchLocationsByIds(locationIds, supabase);

  // 4. Fetch season context
  const seasonContext = episode.season
    ? {
        number: episode.season.number,
        premise: episode.season.description ?? metadata.season_premise,
      }
    : null;

  // 5. Fetch verified facts linked to this episode (for factual content types)
  const verifiedFacts = await fetchEpisodeFacts(episodeId, client);

  // 6. Fetch previous episodes: the memory horizon's window (KB-35)
  const previousEpisodes = episode.project?.id
    ? await fetchPreviousEpisodes(supabase, {
        projectId: episode.project.id,
        currentNumber: episode.number,
        horizon: effectiveMemoryHorizon(episode.project.metadata).memoryHorizon,
        projectType: resolveProjectType(episode.project.metadata).projectType,
        semantic: options.semanticContext
          ? {
              embedder: createVoyageEmbedder({
                apiKey: process.env.VOYAGE_API_KEY,
              }),
              query:
                options.semanticQuery ??
                [episode.title, episode.description].filter(Boolean).join('\n'),
            }
          : undefined,
      })
    : [];

  // 6. Fetch linked verified facts for this episode
  let episodeFacts: EpisodeContext['episodeFacts'] = [];
  try {
    const { data: linkedFactRows } = await client
      .from('episode_facts')
      .select(
        `
        fact:verified_facts (
          id, claim, simplified_claim, category,
          source_citation, source_title, confidence_score
        )
      `,
      )
      .eq('episode_id', episodeId);

    if (linkedFactRows && linkedFactRows.length > 0) {
      episodeFacts = linkedFactRows
        .map((row: Record<string, unknown>) => {
          const fact = row.fact as Record<string, unknown> | null;
          if (!fact) return null;
          return {
            id: fact.id as string,
            claim: fact.claim as string,
            simplifiedClaim: (fact.simplified_claim as string) ?? undefined,
            category: (fact.category as string) ?? undefined,
            sourceCitation: (fact.source_citation as string) ?? undefined,
            sourceTitle: (fact.source_title as string) ?? undefined,
            confidenceScore: (fact.confidence_score as number) ?? undefined,
          };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null);
    }
    console.log(`[buildEpisodeContext] Linked facts: ${episodeFacts.length}`);
  } catch (factError) {
    console.warn(
      '[buildEpisodeContext] Failed to fetch episode facts (non-fatal):',
      factError,
    );
  }

  // Everything below is project text on its way to a prompt: sanitised
  // here, once, so every formatter and handler reads it defused (KB-101).
  return sanitizeStrings({
    premise: storyData.premise ?? episode.description ?? '',
    synopsis: storyData.synopsis,
    episodeNumber: episode.number,
    seasonNumber: seasonContext?.number,

    // Flexible plot structure from roadmap extraction
    beats: storyData.beats,
    moral: storyData.moral,
    signatureLine: storyData.signature_line,
    tags: storyData.tags,

    characters,
    locations,

    seasonPremise: seasonContext?.premise,
    seasonDirectionNotes: episode.season?.direction_notes ?? undefined,
    seasonTheme: undefined, // TODO: Add theme to season schema

    previousEpisodes,
    episodeFacts,

    genre: projectMetadata.genre ?? 'general',
    targetAudience: projectMetadata.targetAudience ?? 'general',
    visualStyle: projectMetadata.videoStyle ?? 'balanced',
    visualToneOverride:
      (metadata as { visual_tone?: string }).visual_tone ?? undefined,
    aestheticStyle: projectMetadata.projectAestheticStyle ?? undefined,

    // Genre-aware pipeline
    projectType: resolveProjectType(episode.project?.metadata).projectType,
    verifiedFacts,

    // Recurring story elements (with backward compat for single element)
    recurringElements: (() => {
      // New array format
      if (
        projectMetadata.recurringElements &&
        projectMetadata.recurringElements.length > 0
      ) {
        return projectMetadata.recurringElements
          .filter((el) => el.enabled)
          .map((el) => ({
            id: el.id ?? crypto.randomUUID(),
            name: el.name ?? 'Recurring Element',
            enabled: true,
            location: el.location,
            purpose: el.purpose,
            placement: el.placement,
            dialogueHints: el.dialogueHints,
          }));
      }
      // Backward compat: old single object format
      if (projectMetadata.recurringElement?.enabled === true) {
        return [
          {
            id: crypto.randomUUID(),
            name: 'Recurring Element',
            enabled: true,
            location: projectMetadata.recurringElement.location,
            purpose: projectMetadata.recurringElement.purpose,
            placement: projectMetadata.recurringElement.placement,
            dialogueHints: projectMetadata.recurringElement.dialogueHints,
          },
        ];
      }
      return undefined;
    })(),
  });
}

/**
 * Fetch verified facts linked to an episode via the episode_facts junction table.
 * Returns facts formatted for the EpisodeContext interface.
 */
async function fetchEpisodeFacts(
  episodeId: string,
  supabase: SupabaseClient<Database>,
): Promise<EpisodeContext['verifiedFacts']> {
  const { data, error } = await supabase
    .from('episode_facts')
    .select(
      `
      fact:verified_facts (
        id,
        claim,
        source_citation,
        category,
        confidence_score,
        source_type
      )
    `,
    )
    .eq('episode_id', episodeId);

  if (error) {
    console.warn(
      `[buildEpisodeContext] Failed to fetch episode facts: ${error.message}`,
    );
    return [];
  }

  const factSchema = z.object({
    id: z.string(),
    claim: z.string(),
    source_citation: z.string().nullable().catch(null),
    category: z.string().nullable().catch(null),
    confidence_score: z.number().nullable().catch(null),
    source_type: z.string().nullable().catch(null),
  });

  return (data ?? [])
    .map((row) => {
      const fact = row.fact;
      const singleFact = Array.isArray(fact) ? fact[0] : fact;
      const parsed = factSchema.safeParse(singleFact);
      return parsed.success ? parsed.data : null;
    })
    .filter((f): f is z.infer<typeof factSchema> => f !== null)
    .map((f) => ({
      id: f.id,
      claim: f.claim,
      sourceCitation: f.source_citation ?? '',
      category: f.category ?? 'general',
      confidence: f.confidence_score ?? 0,
      sourceType: f.source_type ?? 'other',
    }));
}

/**
 * Format verified facts into a prompt-injectable string for factual content types.
 * Facts become NON-NEGOTIABLE plot event constraints that the protagonist experiences.
 */
export function formatVerifiedFactsForPrompt(
  facts: EpisodeContext['verifiedFacts'],
): string {
  if (facts.length === 0) return '';

  const factLines = facts
    .map(
      (f, i) =>
        `FACT ${i + 1} [${f.id}]: ${f.claim}\n  Source: ${f.sourceCitation}\n  Category: ${f.category}`,
    )
    .join('\n\n');

  return `## VERIFIED FACTS — NON-NEGOTIABLE story constraints
Every fact listed below MUST appear in the narrative as an event, discovery,
or experience the character encounters. Do NOT fabricate additional facts.

${factLines}

RULES:
- The protagonist must EXPERIENCE or DISCOVER each fact through immersive action
- Facts dictate WHAT happens. Character personality dictates HOW they react.
- Do NOT add dates, statistics, or claims not in this list
- If a fact seems uncertain, frame it as "believed to be" or "evidence suggests"`;
}

/**
 * Fetch ALL character assets for a project (used when "All Characters" wildcard is tagged)
 * Filters out the dummy "All Characters" placeholder asset.
 */
export async function fetchAllProjectCharacters(
  projectId: string,
  supabase: SupabaseClient<Database>,
): Promise<EpisodeContext['characters']> {
  const { data, error } = await supabase
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
    .eq('project_id', projectId)
    .eq('type', 'character')
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to fetch project characters: ${error.message}`);
  }

  return (data ?? [])
    .filter((asset) => asset.name.toLowerCase() !== 'all characters')
    .map((asset) => {
      const metadata = (asset.metadata as CharacterMetadata) ?? {};

      return {
        id: asset.id,
        name: asset.name,
        role: metadata.role ?? 'character',
        description: asset.description ?? '',
        personality: metadata.personality,
        imageUrl: asset.file_url ?? undefined,
        thumbnailUrl: asset.thumbnail_url ?? undefined,
        physicalAttributes: metadata.physicalAttributes,
        clothingStyle: metadata.clothingStyle,
        elementPrompt: metadata.elementPrompt,
      };
    });
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
  mannerisms?: string;
}

/**
 * Fetch character details by IDs with VEO 3.1 enhanced fields
 */
export async function fetchCharactersByIds(
  characterIds: string[],
  supabase: SupabaseClient<Database>,
): Promise<EpisodeContext['characters']> {
  if (characterIds.length === 0) return [];

  const client = supabase;

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
  visualDescription?: string;
  timeOfDay?: string;
  weather?: string;
  lighting?: string;
  architecture?: string;
}

/**
 * Fetch location details by IDs with VEO 3.1 enhanced fields
 */
export async function fetchLocationsByIds(
  locationIds: string[],
  supabase: SupabaseClient<Database>,
): Promise<EpisodeContext['locations']> {
  if (locationIds.length === 0) return [];

  const client = supabase;

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
 * Format characters for prompt injection with locked identity enforcement.
 * Uses a strong "LOCKED" framing to prevent LLMs from drifting gender, age, or personality.
 */
export function formatCharactersForPrompt(
  characters: EpisodeContext['characters'],
): string {
  if (characters.length === 0) return '';

  const characterBlocks = characters
    .map((c, i) => {
      const lines: string[] = [
        `CHARACTER ${i + 1} — LOCKED IDENTITY (do NOT change gender, age, or personality):`,
        `  Name: ${c.name}`,
        `  Role: ${c.role}`,
        `  Description: ${c.description}`,
      ];

      if (c.personality) {
        lines.push(`  Personality: ${c.personality}`);
      }

      // Include physical attributes if available to reinforce identity
      const attrs = c.physicalAttributes;
      if (attrs) {
        // Raw description from LLM extraction (rich profile)
        if (attrs.rawDescription) {
          lines.push(`  Physical Appearance: ${attrs.rawDescription}`);
        }
        const physParts: string[] = [];
        if (attrs.gender) physParts.push(`Gender: ${attrs.gender}`);
        if (attrs.age) physParts.push(`Age: ${attrs.age}`);
        if (attrs.ageRange) physParts.push(`Age range: ${attrs.ageRange}`);
        if (physParts.length > 0) {
          lines.push(`  Identity (immutable): ${physParts.join(', ')}`);
        }
      }

      // Clothing style (raw or structured)
      const clothing = c.clothingStyle;
      if (clothing) {
        if (clothing.rawDescription) {
          lines.push(`  Clothing Style: ${clothing.rawDescription}`);
        } else if (clothing.defaultOutfit) {
          lines.push(`  Clothing: ${clothing.defaultOutfit}`);
        }
      }

      // Mannerisms from extraction
      const metadata = c as Record<string, unknown>;
      if (metadata.mannerisms && typeof metadata.mannerisms === 'string') {
        lines.push(`  Mannerisms: ${metadata.mannerisms}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');

  return `⚠️ CHARACTER IDENTITIES ARE NON-NEGOTIABLE. Use EXACTLY the characters below with EXACTLY the gender, age, and personality described. Do NOT invent attributes, rename, or rewrite any character.\n\n${characterBlocks}`;
}

/**
 * Format locations for prompt injection
 */
export function formatLocationsForPrompt(
  locations: EpisodeContext['locations'],
): string {
  if (locations.length === 0) return '';

  return `**Locations**:\n${locations
    .map((l) => {
      const parts = [`- **${l.name}** (${l.setting}): ${l.description}`];
      if (l.atmosphere) parts.push(`  Atmosphere: ${l.atmosphere}`);
      // Rich visual metadata from season extraction
      const meta = l as Record<string, unknown>;
      if (
        meta.visualDescription &&
        typeof meta.visualDescription === 'string'
      ) {
        parts.push(`  Visual: ${meta.visualDescription}`);
      }
      if (l.timeOfDay) parts.push(`  Time of Day: ${l.timeOfDay}`);
      if (l.weather) parts.push(`  Weather: ${l.weather}`);
      return parts.join('\n');
    })
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
    const label = ep.relation === 'related' ? ' (related earlier episode)' : '';
    let entry = `- Episode ${ep.number}${label}: "${ep.title}"
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

/**
 * Format recurring elements for prompt injection.
 * Fully dynamic — no hardcoded values. Every word comes from project settings.
 * Placement-aware: generates distinct instruction text for beginning/middle/end/throughout.
 */
export function formatRecurringElementsForPrompt(
  recurringElements: EpisodeContext['recurringElements'],
): string {
  if (!recurringElements || recurringElements.length === 0) return '';

  const placementInstruction: Record<string, string> = {
    beginning: 'at the START of the episode — before the main story hook',
    middle: 'at a natural midpoint of the episode',
    end: 'as the FINAL moment of the episode — nothing follows it',
    throughout:
      'at multiple natural points distributed across the entire episode',
  };

  const elementBlocks = recurringElements.map((el, i) => {
    const placement = (el.placement ?? 'end').toLowerCase();
    const when =
      placementInstruction[placement] ??
      `at the ${el.placement} of the episode`;

    const lines: string[] = [
      `### Element ${i + 1}: "${el.name}" (Placement: ${el.placement ?? 'End'})`,
      '',
      `This element MUST appear ${when}.`,
      '',
    ];

    if (el.location) {
      lines.push(`**Location / Context**: ${el.location}`);
      lines.push(
        'If the story is already in this location at the placement point, embed the element naturally.',
        'If not, transition to this location at the appropriate time.',
        '',
      );
    }

    if (el.purpose) {
      lines.push(`**What must happen**: ${el.purpose}`);
      lines.push('');
    }

    if (el.dialogueHints) {
      lines.push(
        '**Character voice & tone reference** (study the patterns below to understand HOW these characters think, speak, and emote — then generate COMPLETELY ORIGINAL dialogue that captures the same cadence, vocabulary level, and emotional texture):',
        '',
        el.dialogueHints,
        '',
        '⚠️ The above are CHARACTER VOICE REFERENCES, not templates. ' +
          'NEVER reproduce or closely paraphrase any specific line from these references. ' +
          'Instead, internalize the speech patterns, emotional register, ' +
          'and personality traits demonstrated across ALL examples, ' +
          "then write fresh dialogue that sounds authentically like these characters in THIS episode's unique situation.",
      );
      lines.push('');
    }

    return lines.join('\n');
  });

  return [
    '---',
    '## RECURRING STORY ELEMENTS — ALL REQUIRED',
    '',
    ...elementBlocks,
    '---',
  ].join('\n');
}

/** @deprecated Use formatRecurringElementsForPrompt instead */
export const formatRecurringElementForPrompt = (
  recurringElement:
    | {
        enabled: boolean;
        location?: string;
        purpose?: string;
        placement?: 'beginning' | 'middle' | 'end' | 'throughout';
        dialogueHints?: string;
      }
    | undefined,
): string => {
  if (!recurringElement?.enabled) return '';
  return formatRecurringElementsForPrompt([
    {
      id: 'legacy',
      name: 'Recurring Element',
      ...recurringElement,
    },
  ]);
};

/**
 * Format plot beats for prompt injection
 * Formats the flexible beats array, moral, and signature line extracted from roadmap
 */
export function formatBeatsForPrompt(
  context: Pick<
    EpisodeContext,
    'beats' | 'moral' | 'signatureLine' | 'synopsis'
  >,
): string {
  const parts: string[] = [];

  // Synopsis if available
  if (context.synopsis) {
    parts.push(`**Episode Synopsis**: ${context.synopsis}`);
    parts.push('');
  }

  // Beats from roadmap (preserving original labels)
  if (context.beats && context.beats.length > 0) {
    parts.push(
      '**Plot Structure** (follow this structure from the creator roadmap):',
    );
    context.beats.forEach((beat) => {
      parts.push(`- **${beat.label}**: ${beat.content}`);
    });
    parts.push('');
  }

  // Moral/theme
  if (context.moral) {
    parts.push(`**Moral/Theme**: ${context.moral}`);
    parts.push(
      'The story should naturally lead to this moral at the resolution.',
    );
    parts.push('');
  }

  // Signature line/catchphrase
  if (context.signatureLine) {
    parts.push(`**Signature Line** (must include): "${context.signatureLine}"`);
    parts.push(
      'Include this line at an appropriate moment, typically near the resolution or moral delivery.',
    );
    parts.push('');
  }

  if (parts.length === 0) return '';

  return parts.join('\n');
}

/**
 * Merge story-specific character arcs into the pre-formatted character
 * context block. Lives in `@kit/generation` (the screenplay stage renders
 * the same block for its brief, FILM-1901); re-exported for the worker.
 */
export { mergeCharacterArcs } from '@kit/generation';

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
 * Format linked episode facts into a prompt-injectable string.
 * Used by story-generation and screenplay-conversion handlers to ensure
 * fact accuracy in generated content.
 */
export function formatFactsForPrompt(
  facts: EpisodeContext['episodeFacts'],
): string {
  if (!facts || facts.length === 0) return '';

  const factLines = facts
    .map((f, i) => {
      const source = f.sourceCitation ? ` [Source: ${f.sourceCitation}]` : '';
      const category = f.category ? ` (${f.category})` : '';
      return `FACT ${i + 1}${category}: ${f.claim}${source}`;
    })
    .join('\n');

  return [
    '## VERIFIED FACTS — These are REAL, verified facts that MUST be used accurately in the story.',
    '',
    factLines,
    '',
    'Rules:',
    '- Use exact numbers and claims from these facts',
    '- Do NOT paraphrase vaguely ("a lot of pressure" → use the exact figure)',
    '- Every fact should appear in the story unless irrelevant to the narrative',
    '- Never fabricate additional scientific claims not in this list',
  ].join('\n');
}
