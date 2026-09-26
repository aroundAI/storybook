import type { SupabaseClient } from '@supabase/supabase-js';

import { sanitizeForPrompt, sanitizeStrings } from '@kit/episodes/lib';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import { executeLLMForLambda } from '../llm-utils';

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

const CHARACTER_INSTRUCTIONS =
  'Write a 4-6 sentence description including: Physical appearance (approximate age, ethnicity/skin tone, build, hair color/style, eye color, distinguishing features like scars or tattoos). Clothing and style (what they wear in this story). Demeanor and expression (how they carry themselves, typical body language). Their role and significance. Be specific — commit to physical details based on what the text states or implies from the setting/time period.';

const LOCATION_INSTRUCTIONS =
  'Write a 3-5 sentence description including: Physical environment (size, architecture, materials, colors, lighting). Atmosphere and mood (sounds, smells, temperature). Notable features (landmarks, furniture, natural elements). How this place functions in the story. Be vivid and specific for environment concept art generation.';

function buildScreenplayContext(scenes: ScreenplayScene[]): string {
  if (scenes.length === 0) return '';

  const text = scenes
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

  return text.slice(0, 10000);
}

export async function processAssetCreation(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<AssetCreationResult> {
  const data = parseLlmJobPayload('asset-creation', payload);

  console.log(
    `[Asset Creation] Processing for episode ${data.episodeId}, project ${data.projectId}`,
  );

  // 1. Fetch episode screenplay_data
  const { data: episode, error: episodeError } = await supabase
    .from('episodes')
    .select('id, screenplay_data')
    .eq('id', data.episodeId)
    .single();

  if (episodeError || !episode) {
    throw new Error(
      `Episode not found: ${episodeError?.message ?? 'no data returned'}`,
    );
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

  // 4. Build screenplay context for LLM
  // The stored screenplay, defused for the model (KB-101)
  const storyContext = buildScreenplayContext(sanitizeStrings(scenes));

  // 5. Query existing assets in the project
  const allNames = [...characterNames, ...locationNames];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingAssets } = await (supabase as any)
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

  let newAssets: Array<{ id: string; name: string; type: string }> = [];

  if (itemsToCreate.length > 0) {
    // 7. Extract descriptions in parallel via LLM
    const descriptionResults = await Promise.allSettled(
      itemsToCreate.map(async (item) => {
        try {
          const result = await executeLLMForLambda<{ description: string }>({
            templateSlug: 'story-generation/extract-asset-description',
            variables: {
              // The asset keeps its name as written; the model sees it defused
              name: sanitizeForPrompt(item.name),
              type: item.type,
              extra_context: '',
              type_instructions:
                item.type === 'character'
                  ? CHARACTER_INSTRUCTIONS
                  : LOCATION_INSTRUCTIONS,
              story_context: storyContext,
            },
          });

          return result.data.description;
        } catch (err) {
          console.error(
            `[Asset Creation] LLM extraction failed for "${item.name}":`,
            err,
          );
          return '';
        }
      }),
    );

    // 8. Build asset rows
    const assetRows = itemsToCreate.map((item, i) => {
      const descResult = descriptionResults[i];
      const description =
        descResult?.status === 'fulfilled' ? descResult.value : '';

      return {
        project_id: data.projectId,
        type: item.type,
        name: item.name,
        description:
          description ||
          `${item.type === 'character' ? 'Character' : 'Location'} from story`,
        metadata: { autoCreated: true },
      };
    });

    // 9. Upsert assets (handles soft-deleted with same name)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: created, error: insertError } = await (supabase as any)
      .from('assets')
      .upsert(
        assetRows.map((row) => ({ ...row, deleted_at: null })),
        {
          onConflict: 'project_id,type,name',
          ignoreDuplicates: false,
        },
      )
      .select('id, name, type');

    if (insertError) {
      console.error('[Asset Creation] Upsert failed:', insertError);
      throw new Error('Failed to create assets');
    }

    newAssets = (created ?? []) as Array<{
      id: string;
      name: string;
      type: string;
    }>;

    console.log(`[Asset Creation] Created ${newAssets.length} new assets`);
  }

  // 10. Combine existing + new assets
  const allAssets = [...Array.from(existingMap.values()), ...newAssets];

  // 11. Link all to episode metadata
  if (allAssets.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: currentEpisode } = await (supabase as any)
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
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
