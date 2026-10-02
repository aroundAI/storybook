/**
 * Asset Creation Handler
 *
 * Creates the characters and locations a screenplay names and links them
 * to the episode. Each description is the `asset_description` stage of
 * `@kit/generation` (FILM-1901): prepare → run.write → schema → commit
 * (the `assets` upsert). What stays here is the job itself: reading the
 * names out of the screenplay, skipping assets the project already has,
 * linking every asset to the episode's metadata, and the generation_jobs
 * row the bulk action inserted as 'asset_creation' (KB-174), which this
 * handler now moves through processing to completed or failed.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireRun } from '@kit/ai-gateway';
import {
  type AssetDescriptionOutput,
  type AssetDescriptionTarget,
  assetDescriptionStage,
  fallbackDescription,
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
} from '@kit/generation';
import {
  type LlmJobPayload,
  parseLlmJobPayload,
} from '@kit/prompt-engine/llm-job-payloads';
import { whyNoRow } from '@kit/shared/rows';
import type { Database } from '@kit/supabase/database';

import { workerCtx } from '../utils/stage-runtime';

interface AssetCreationResult {
  success: boolean;
  data: {
    episodeId: string;
    created: number;
    linked: number;
    skipped: number;
    characters: string[];
    locations: string[];
  };
}

interface ScreenplayScene {
  number: number;
  heading: string;
  location?: string;
  description?: string;
  dialogue?: Array<{
    character: string;
    text?: string;
    dialogue?: string;
    parenthetical?: string;
  }>;
}

interface ScreenplayData {
  metadata?: {
    characters?: string[];
    locations?: string[];
  };
  scenes?: ScreenplayScene[];
}

function buildScreenplayContext(scenes: ScreenplayScene[]): string {
  if (scenes.length === 0) return '';

  return scenes
    .map((scene) => {
      const parts: string[] = [];
      parts.push(`SCENE ${scene.number}: ${scene.heading}`);
      if (scene.description) parts.push(scene.description);
      if (scene.dialogue?.length) {
        for (const d of scene.dialogue) {
          const paren = d.parenthetical ? ` (${d.parenthetical})` : '';
          const dialogueText = d.text ?? d.dialogue ?? '';
          parts.push(`${d.character}${paren}: "${dialogueText}"`);
        }
      }
      return parts.join('\n');
    })
    .join('\n\n');
}

export async function processAssetCreation(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<AssetCreationResult> {
  const data = parseLlmJobPayload('asset-creation', payload);

  console.log(
    `[Asset Creation] Processing for episode ${data.episodeId}, project ${data.projectId}`,
  );

  await markJobProcessing(supabase, data.episodeId, JOB_TYPE);

  try {
    const result = await createAssetsFromScreenplay(data, supabase);

    await markJobCompleted(supabase, data.episodeId, JOB_TYPE, {
      created: result.data.created,
      linked: result.data.linked,
      characters: result.data.characters.length,
      locations: result.data.locations.length,
    });

    return result;
  } catch (error) {
    await markJobFailed(
      supabase,
      data.episodeId,
      JOB_TYPE,
      error instanceof Error ? error.message : 'Unknown error',
    );
    throw error;
  }
}

const JOB_TYPE = 'asset_creation';

async function createAssetsFromScreenplay(
  data: LlmJobPayload<'asset-creation'>,
  supabase: SupabaseClient<Database>,
): Promise<AssetCreationResult> {
  // 1. Fetch episode screenplay_data
  const { data: episode, error: episodeError } = await supabase
    .from('episodes')
    .select('id, screenplay_data')
    .eq('id', data.episodeId)
    .single();

  if (episodeError || !episode) {
    throw new Error(whyNoRow(episodeError, 'Episode not found'));
  }

  const screenplayData = episode.screenplay_data as ScreenplayData | null;

  if (!screenplayData?.scenes?.length) {
    throw new Error(
      `Episode ${data.episodeId} has no screenplay_data or no scenes — cannot extract assets`,
    );
  }

  const scenes = screenplayData.scenes;

  // 2. Extract character names (metadata first, fallback to dialogue extraction)
  const characterNames: string[] =
    screenplayData.metadata?.characters ??
    Array.from(
      new Set(scenes.flatMap((s) => s.dialogue?.map((d) => d.character) ?? [])),
    );

  // 3. Extract location names (metadata first, fallback to scene locations)
  const locationNames: string[] =
    screenplayData.metadata?.locations ??
    Array.from(
      new Set(
        scenes
          .map((s) => s.location)
          .filter((loc): loc is string => Boolean(loc)),
      ),
    );

  console.log(
    `[Asset Creation] Found ${characterNames.length} characters, ${locationNames.length} locations`,
  );

  if (characterNames.length === 0 && locationNames.length === 0) {
    console.log(
      '[Asset Creation] No characters or locations found — returning early',
    );

    return {
      success: true,
      data: {
        episodeId: data.episodeId,
        created: 0,
        linked: 0,
        skipped: 0,
        characters: [],
        locations: [],
      },
    };
  }

  // 4. The screenplay as the text each description is read from; the
  // stage's prepare defuses it for the model (KB-101)
  const storyContext = buildScreenplayContext(scenes);

  // 5. Query existing assets in the project
  const allNames = [...characterNames, ...locationNames];

  const { data: existingAssets } = await supabase
    .from('assets')
    .select('id, name, type')
    .eq('project_id', data.projectId)
    .in('name', allNames)
    .is('deleted_at', null);

  const existingMap = new Map<
    string,
    { id: string; name: string; type: string }
  >();

  for (const a of existingAssets ?? []) {
    existingMap.set(`${a.type}:${a.name.toLowerCase()}`, a);
  }

  console.log(
    `[Asset Creation] ${existingMap.size} assets already exist in project`,
  );

  // 6. Determine which items need to be created
  const allItems = [
    ...characterNames.map((name) => ({ name, type: 'character' as const })),
    ...locationNames.map((name) => ({ name, type: 'location' as const })),
  ];

  const itemsToCreate = allItems.filter(
    (item) => !existingMap.has(`${item.type}:${item.name.toLowerCase()}`),
  );

  const linkedExisting = allItems.length - itemsToCreate.length;

  console.log(
    `[Asset Creation] ${itemsToCreate.length} items to create, ${existingMap.size} already exist`,
  );

  const newAssets: Array<{ id: string; name: string; type: string }> = [];

  if (itemsToCreate.length > 0) {
    const run = requireRun('asset creation');
    const ctx = workerCtx(supabase, data, run);
    const stage = assetDescriptionStage;

    const targets: AssetDescriptionTarget[] = itemsToCreate.map((item) => ({
      projectId: data.projectId,
      asset: { name: item.name, type: item.type },
      storyContext,
    }));

    // 7. Describe in parallel; a failed description still gets an asset
    const described = await Promise.all(
      targets.map(async (target) => {
        const [part] = await stage.parts(ctx, target);

        try {
          const brief = await stage.prepare(ctx, target, part!);
          const generated = await run.write({ ...brief, runId: run.id });
          const output: AssetDescriptionOutput = stage.outputSchema.parse(
            generated.output,
          );

          return { output, brief, usage: generated.usage };
        } catch (err) {
          console.error(
            `[Asset Creation] LLM extraction failed for "${target.asset.name}":`,
            err,
          );

          return {
            output: { description: fallbackDescription(target.asset.type) },
          };
        }
      }),
    );

    // 8. Commit each asset row (upsert resurrects a soft-deleted namesake)
    for (const [index, target] of targets.entries()) {
      const { output, usage } = described[index]!;
      const committed = await stage.commit(
        ctx,
        run.toGenerationRun(usage),
        target,
        [output],
      );

      newAssets.push(committed.data.asset);
    }

    console.log(`[Asset Creation] Created ${newAssets.length} new assets`);
  }

  // 9. Combine existing + new assets
  const allAssets = [...Array.from(existingMap.values()), ...newAssets];

  // 10. Link all to episode metadata
  if (allAssets.length > 0) {
    const { data: currentEpisode } = await supabase
      .from('episodes')
      .select('metadata')
      .eq('id', data.episodeId)
      .single();

    const metadata = (currentEpisode?.metadata ?? {}) as Record<
      string,
      unknown
    >;
    const charIds = new Set(
      (metadata.character_ids as string[] | undefined) ?? [],
    );
    const locIds = new Set(
      (metadata.location_ids as string[] | undefined) ?? [],
    );

    const finalCharNames =
      (metadata.character_names as string[] | undefined) ?? [];
    const finalLocNames =
      (metadata.location_names as string[] | undefined) ?? [];

    for (const asset of allAssets) {
      if (asset.type === 'character') {
        charIds.add(asset.id);

        if (
          !finalCharNames.some(
            (n) => n.toLowerCase() === asset.name.toLowerCase(),
          )
        ) {
          finalCharNames.push(asset.name);
        }
      } else if (asset.type === 'location') {
        locIds.add(asset.id);

        if (
          !finalLocNames.some(
            (n) => n.toLowerCase() === asset.name.toLowerCase(),
          )
        ) {
          finalLocNames.push(asset.name);
        }
      }
    }

    await supabase
      .from('episodes')
      .update({
        metadata: {
          ...metadata,
          character_ids: Array.from(charIds),
          location_ids: Array.from(locIds),
          character_names: finalCharNames,
          location_names: finalLocNames,
        },
      })
      .eq('id', data.episodeId);

    console.log(
      `[Asset Creation] Linked ${allAssets.length} assets to episode metadata`,
    );
  }

  console.log(
    `[Asset Creation] Complete — created: ${newAssets.length}, linked: ${linkedExisting}`,
  );

  return {
    success: true,
    data: {
      episodeId: data.episodeId,
      created: newAssets.length,
      linked: linkedExisting,
      skipped: 0,
      characters: characterNames,
      locations: locationNames,
    },
  };
}
