'use server';

import { revalidatePath } from 'next/cache';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { authorizeProjectTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  AnalyzeSeasonSchema,
  GenerateSeasonEpisodesSchema,
} from '../../schemas/season-generation.schema';
import { generateEpisodeSlug } from '../../slug-utils';

interface EpisodeBeat {
  label: string;
  content: string;
}

interface ExtractedEpisode {
  number: number;
  title: string;
  synopsis: string;
  beats: EpisodeBeat[];
  moral?: string | null;
  signature_line?: string | null;
  character_names?: string[];
  location_names?: string[];
  characterNames?: string[];
  locationNames?: string[];
  tags?: string[];
}

interface _AnalysisResult {
  premise: string;
  tone?: string | null;
  target_audience?: string | null;
  characters: Array<{
    name: string;
    role: string;
    description: string;
    physicalDescription?: string;
    clothingStyle?: string;
    mannerisms?: string;
  }>;
  locations: Array<{
    name: string;
    setting: string;
    description: string;
    visualDescription?: string;
    timeOfDay?: string | null;
    weather?: string | null;
  }>;
  episodes: ExtractedEpisode[];
}

/**
 * Analyze Roadmap
 * Queues the roadmap analysis LLM call for background processing via Lambda.
 * Results are delivered via WebSocket.
 */
export const analyzeSeasonRoadmapAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'season.analyze', projectId: data.projectId };

    logger.info(ctx, 'Queuing roadmap analysis for background processing');

    // Get the current user for WebSocket delivery
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const target = await authorizeProjectTarget(client, data.projectId);

    if (!target) {
      throw new ActionRefusal('Project not found');
    }

    // Always queue to Lambda for processing
    const { queueLlmJob } = await import('@kit/prompt-engine/server');

    await queueLlmJob({
      jobType: 'season-analysis',
      userId: user.id,
      target,
      payload: {
        projectId: data.projectId,
        roadmap: data.roadmap,
        externalFacts: data.externalFacts,
      },
    });

    logger.info(ctx, 'Job queued successfully');
    return { success: true, queued: true };
  },
  { schema: AnalyzeSeasonSchema },
);

/**
 * Generate Season Episodes
 * Creates Assets (Characters, Locations) and Episodes based on approved analysis
 */
export const generateSeasonEpisodesAction = enhanceAction(
  async (data) => {
    try {
      const logger = await getLogger();
      const ctx = { name: 'season.generate', projectId: data.projectId };
      logger.info(ctx, 'Generating season episodes and assets');

      const client = getSupabaseServerClient();
      const { data: user, error: authError } = await requireUser(client);

      if (authError || !user) {
        console.error('[Season Generate] Auth failed:', authError);
        return { success: false as const, error: 'Authentication required' };
      }

      // 1. Create New Characters (skip any that already exist in the project)
      const createdCharacterIds: Record<string, string> = {};

      if (data.charactersToCreate.length > 0) {
        // Check which characters already exist (by name) to avoid overwriting user-curated data
        const charNames = data.charactersToCreate.map((c) => c.name);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existingChars } = await (client as any)
          .from('assets')
          .select('id, name')
          .eq('project_id', data.projectId)
          .eq('type', 'character')
          .in('name', charNames)
          .is('deleted_at', null);

        // Map existing characters by name for quick lookup
        const existingCharMap = new Map<string, string>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        existingChars?.forEach((a: any) => existingCharMap.set(a.name, a.id));

        // Only insert characters that don't already exist
        const newChars = data.charactersToCreate.filter(
          (c) => !existingCharMap.has(c.name),
        );

        // Add existing ones directly to the ID map
        existingCharMap.forEach((id, name) => {
          createdCharacterIds[name] = id;
        });

        if (newChars.length > 0) {
          const assetsToInsert = newChars.map((char) => ({
            project_id: data.projectId,
            type: 'character',
            name: char.name,
            description: char.description || '',
            metadata: {
              role: char.role,
              personality: char.description,
              physicalAttributes: char.physicalDescription
                ? { rawDescription: char.physicalDescription }
                : undefined,
              clothingStyle: char.clothingStyle
                ? { rawDescription: char.clothingStyle }
                : undefined,
              mannerisms: char.mannerisms,
            },
          }));

          const { data: insertedAssets, error: assetError } =
            await // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (client as any)
              .from('assets')
              .insert(assetsToInsert)
              .select('id, name');

          if (assetError) {
            console.error(
              '[Season Generate] Character creation failed:',
              assetError,
            );
            return {
              success: false as const,
              error: `Failed to create characters: ${assetError.message}`,
            };
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          insertedAssets?.forEach((asset: any) => {
            createdCharacterIds[asset.name] = asset.id;
          });
        }
      }

      // 2. Create New Locations
      const createdLocationIds: Record<string, string> = {};

      if (data.locationsToCreate && data.locationsToCreate.length > 0) {
        // Check which locations already exist (by name) to avoid overwriting user-curated data
        const locNames = data.locationsToCreate.map((l) => l.name);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existingLocs } = await (client as any)
          .from('assets')
          .select('id, name')
          .eq('project_id', data.projectId)
          .eq('type', 'location')
          .in('name', locNames);

        const existingLocMap = new Map<string, string>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        existingLocs?.forEach((a: any) => existingLocMap.set(a.name, a.id));

        const newLocs = data.locationsToCreate.filter(
          (l) => !existingLocMap.has(l.name),
        );

        existingLocMap.forEach((id, name) => {
          createdLocationIds[name] = id;
        });

        if (newLocs.length > 0) {
          const locationsToInsert = newLocs.map((loc) => ({
            project_id: data.projectId,
            type: 'location',
            name: loc.name,
            description: loc.description || '',
            metadata: {
              setting: loc.setting,
              visualDescription: loc.visualDescription,
              timeOfDay: loc.timeOfDay,
              weather: loc.weather,
            },
          }));

          const { data: insertedLocations, error: locError } =
            await // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (client as any)
              .from('assets')
              .insert(locationsToInsert)
              .select('id, name');

          if (locError) {
            console.error(
              '[Season Generate] Location creation failed:',
              locError,
            );
            return {
              success: false as const,
              error: `Failed to create locations: ${locError.message}`,
            };
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          insertedLocations?.forEach((asset: any) => {
            createdLocationIds[asset.name] = asset.id;
          });
        }
      }

      // 3. Resolve IDs
      const finalCharacterMap = {
        ...data.characterMappings,
        ...createdCharacterIds,
      };
      const finalLocationMap = {
        ...data.locationMappings,
        ...createdLocationIds,
      };

      // 4. Create Season Record
      let seasonId: string | null = null;

      // Get the next season number
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingSeasons } = await (client as any)
        .from('seasons')
        .select('number')
        .eq('project_id', data.projectId)
        .is('deleted_at', null)
        .order('number', { ascending: false })
        .limit(1);

      const nextSeasonNumber = (existingSeasons?.[0]?.number ?? 0) + 1;

      // Create the season

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: insertedSeason, error: seasonError } = await (client as any)
        .from('seasons')
        .insert({
          project_id: data.projectId,
          number: nextSeasonNumber,
          name: data.seasonName || `Season ${nextSeasonNumber}`,
          description: data.premise || null,
        })
        .select()
        .single();

      if (seasonError) {
        console.error('[Season Generate] Season creation failed:', seasonError);
        return {
          success: false as const,
          error: `Failed to create season: ${seasonError.message}`,
        };
      }

      seasonId = insertedSeason.id;
      logger.info(
        { ...ctx, seasonId, seasonNumber: nextSeasonNumber },
        'Season created',
      );

      // 5. Create Episodes (linked to season)
      const episodesToInsert = data.episodes.map((ep) => {
        // Handle both naming conventions from LLM output
        const charNames = ep.characterNames || ep.character_names || [];
        const locNames = ep.locationNames || ep.location_names || [];

        const characterIds =
          (charNames
            .map((name) => finalCharacterMap[name])
            .filter(Boolean) as string[]) ?? [];

        const locationIds =
          (locNames
            .map((name) => finalLocationMap[name])
            .filter(Boolean) as string[]) ?? [];

        // Use synopsis as primary description, fallback to legacy description
        const description = ep.synopsis || '';

        // Build premise from beats if synopsis is empty
        const buildPremiseFromBeats = () => {
          if (ep.beats && ep.beats.length > 0) {
            return ep.beats.map((b) => `${b.label}: ${b.content}`).join(' | ');
          }
          return description;
        };

        return {
          project_id: data.projectId,
          season_id: seasonId,
          number: ep.number,
          title: ep.title,
          slug: generateEpisodeSlug(ep.number, ep.title),
          description,
          status: 'draft',
          story_data: {
            // Synopsis as primary premise
            premise: ep.synopsis || buildPremiseFromBeats(),
            // Store flexible beats array (preserves original labels)
            beats: ep.beats || [],
            // Store moral if present
            moral: ep.moral || null,
            // Store signature line (catchphrase) if present
            signature_line: ep.signature_line || null,
            // Store tags for genre/mood
            tags: ep.tags || [],
          },
          metadata: {
            character_ids: characterIds,
            location_ids: locationIds,
            // Store names for immediate display in episode header (before story/screenplay)
            character_names: charNames,
            location_names: locNames,
            season_premise: data.premise,
            season_tone: data.tone || null,
            target_audience: data.targetAudience || null,
          },
        };
      });

      if (episodesToInsert.length === 0) {
        return { success: true as const, count: 0, seasonId };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: episodeError } = await (client as any)
        .from('episodes')
        .insert(episodesToInsert);

      if (episodeError) {
        console.error(
          '[Season Generate] Episode creation failed:',
          episodeError,
        );
        return {
          success: false as const,
          error: `Failed to create episodes: ${episodeError.message}`,
        };
      }

      revalidatePath('/home/[account]/studio/[projectSlug]/episodes', 'page');
      revalidatePath('/home/[account]/studio/[projectSlug]/assets', 'page');

      return {
        success: true as const,
        seasonId,
        count: episodesToInsert.length,
        createdCharacters: Object.keys(createdCharacterIds).length,
        createdLocations: Object.keys(createdLocationIds).length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Season Generate] Unexpected error:', message, err);
      return { success: false as const, error: message };
    }
  },
  { schema: GenerateSeasonEpisodesSchema },
);
