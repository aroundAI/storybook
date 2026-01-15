'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
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

interface AnalysisResult {
  premise: string;
  tone?: string | null;
  target_audience?: string | null;
  characters: Array<{ name: string; role: string; description: string }>;
  locations: Array<{ name: string; setting: string; description: string }>;
  episodes: ExtractedEpisode[];
}

/**
 * Step 1: Analyze Roadmap
 * Queues the roadmap analysis LLM call for background processing.
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

    // Check if we're in Lambda environment (production)
    const { isLambdaEnvironment, queueLlmJob } = await import(
      '@kit/prompt-engine/server'
    );

    if (isLambdaEnvironment()) {
      // Production: Queue for background processing
      await queueLlmJob({
        jobType: 'season-analysis',
        userId: user.id,
        payload: {
          projectId: data.projectId,
          roadmap: data.roadmap,
        },
      });

      logger.info(ctx, 'Job queued successfully');

      return { success: true, queued: true };
    } else {
      // Local development: Run synchronously (no SQS available)
      logger.info(ctx, 'Running synchronously (local dev mode)');

      // 1. Load and render prompt template
      const { loadAndRenderPrompt } = await import('@kit/prompt-engine/server');
      const renderedPrompt = await loadAndRenderPrompt('season-generation', {
        roadmap: data.roadmap,
      });

      // 2. Determine API key based on provider from prompt template
      const provider = renderedPrompt.llmConfig.provider || 'deepseek';
      let apiKey: string | undefined;

      switch (provider) {
        case 'gemini':
          apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
          break;
        case 'deepseek':
          apiKey = process.env.DEEPSEEK_API_KEY;
          break;
        case 'openai':
          apiKey = process.env.OPENAI_API_KEY;
          break;
        case 'anthropic':
          apiKey = process.env.ANTHROPIC_API_KEY;
          break;
        default:
          apiKey = process.env.DEEPSEEK_API_KEY;
      }

      if (!apiKey) {
        throw new Error(`API key not configured for provider: ${provider}`);
      }

      const { createLLMClient } = await import('@kit/llm');

      const llm = createLLMClient({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provider: provider as any,
        model: renderedPrompt.llmConfig.model,
        apiKey,
        temperature: renderedPrompt.llmConfig.temperature,
        maxTokens: renderedPrompt.llmConfig.max_tokens,
      });

      const messages = [
        { role: 'system', content: renderedPrompt.systemPrompt },
        { role: 'user', content: renderedPrompt.userPrompt },
      ];

      try {
        const response = await llm.createChatCompletion({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: messages as any,
        });
        const content = response.message.content;

        if (!content) throw new Error('Empty response from LLM');

        // Enhanced JSON extraction: handle markdown fences and whitespace
        let jsonString = content.trim();

        // Remove markdown code fences if present
        const codeBlockMatch = jsonString.match(
          /```(?:json)?\s*\n([\s\S]*?)\n```/,
        );
        if (codeBlockMatch && codeBlockMatch[1]) {
          jsonString = codeBlockMatch[1].trim();
        }

        // Attempt to parse JSON
        let result: AnalysisResult;
        try {
          result = JSON.parse(jsonString) as AnalysisResult;
        } catch (parseError) {
          logger.error(
            {
              ...ctx,
              error: parseError,
              contentLength: content.length,
              contentPreview: content.substring(0, 500),
            },
            'JSON parse error',
          );

          throw new Error(
            'LLM returned invalid JSON. Try a shorter roadmap.',
          );
        }

        // Validate required fields
        if (!result.episodes || !Array.isArray(result.episodes)) {
          throw new Error('Invalid response format: missing episodes array');
        }

        if (!result.premise) {
          result.premise = 'Generated from roadmap';
        }

        if (!result.characters) {
          result.characters = [];
        }

        if (!result.locations) {
          result.locations = [];
        }

        logger.info(
          {
            ...ctx,
            episodeCount: result.episodes.length,
            characterCount: result.characters.length,
            locationCount: result.locations.length,
          },
          'Successfully analyzed roadmap',
        );

        return { success: true, data: result };
      } catch (error) {
        logger.error({ ...ctx, error }, 'Analysis failed');
        throw new Error(
          'Failed to analyze roadmap. Please try again.',
        );
      }
    }
  },
  { schema: AnalyzeSeasonSchema },
);

/**
 * Step 2: Generate
 * Creates Assets (Characters, Locations) and Episodes based on approved analysis
 */
export const generateSeasonEpisodesAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'season.generate', projectId: data.projectId };
    logger.info(ctx, 'Generating season episodes and assets');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) throw new Error('Authentication required');

    // 1. Create New Characters
    const createdCharacterIds: Record<string, string> = {};

    if (data.charactersToCreate.length > 0) {
      const assetsToInsert = data.charactersToCreate.map((char) => ({
        project_id: data.projectId,
        type: 'character',
        name: char.name,
        description: char.role
          ? `${char.role} - ${char.description}`
          : char.description,
        metadata: { personality: char.description },
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: insertedAssets, error: assetError } = await (client as any)
        .from('assets')
        .insert(assetsToInsert)
        .select('id, name');

      if (assetError) {
        logger.error(
          { ...ctx, error: assetError },
          'Failed to create character assets',
        );
        throw new Error('Failed to create characters');
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      insertedAssets?.forEach((asset: any) => {
        createdCharacterIds[asset.name] = asset.id;
      });
    }

    // 2. Create New Locations
    const createdLocationIds: Record<string, string> = {};

    if (data.locationsToCreate && data.locationsToCreate.length > 0) {
      const locationsToInsert = data.locationsToCreate.map((loc) => ({
        project_id: data.projectId,
        type: 'location',
        name: loc.name,
        description: loc.setting
          ? `${loc.setting} - ${loc.description}`
          : loc.description,
        metadata: { setting: loc.setting },
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: insertedLocations, error: locError } = await (client as any)
        .from('assets')
        .insert(locationsToInsert)
        .select('id, name');

      if (locError) {
        logger.error(
          { ...ctx, error: locError },
          'Failed to create location assets',
        );
        throw new Error('Failed to create locations');
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      insertedLocations?.forEach((asset: any) => {
        createdLocationIds[asset.name] = asset.id;
      });
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
      logger.error({ ...ctx, error: seasonError }, 'Failed to create season');
      throw new Error('Failed to create season');
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
          return ep.beats.map(b => `${b.label}: ${b.content}`).join(' | ');
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
          season_premise: data.premise,
          season_tone: data.tone || null,
          target_audience: data.targetAudience || null,
        },
      };
    });

    if (episodesToInsert.length === 0) {
      return { success: true, count: 0, seasonId };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: episodeError } = await (client as any)
      .from('episodes')
      .insert(episodesToInsert);

    if (episodeError) {
      logger.error(
        { ...ctx, error: episodeError },
        'Failed to create episodes',
      );
      throw new Error('Failed to create episodes');
    }

    // Audit Log logic (simplified)
    // ... (Skipping full audit log detail for brevity in this refactor, relying on standard logs)

    revalidatePath('/home/[account]/studio/[projectSlug]/episodes', 'page');
    revalidatePath('/home/[account]/studio/[projectSlug]/assets', 'page'); // In case we added assets

    return {
      success: true,
      seasonId,
      count: episodesToInsert.length,
      createdCharacters: Object.keys(createdCharacterIds).length,
      createdLocations: Object.keys(createdLocationIds).length,
    };
  },
  { schema: GenerateSeasonEpisodesSchema },
);
