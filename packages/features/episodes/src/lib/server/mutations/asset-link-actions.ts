'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Schema for extracting a description from story text via LLM
 */
const ExtractDescriptionSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['character', 'location']),
  role: z.string().optional(),
  arc: z.string().optional(),
  storyContext: z.string().max(50000),
});

/**
 * Schema for linking an existing asset to an episode
 */
const LinkAssetToEpisodeSchema = z.object({
  episodeId: z.string().uuid(),
  assetId: z.string().uuid(),
  assetName: z.string().min(1),
  assetType: z.enum(['character', 'location']),
});

/**
 * Schema for batch-creating assets and linking them to an episode
 */
const BatchCreateUnlinkedSchema = z.object({
  projectId: z.string().uuid(),
  episodeId: z.string().uuid(),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        type: z.enum(['character', 'location']),
        role: z.string().optional(),
        arc: z.string().optional(),
      }),
    )
    .min(1)
    .max(20),
  storyContext: z.string().max(50000),
});

/**
 * Extracts a concise description for a character or location from story text.
 * Uses LLM (extract-asset-description template) — gracefully returns empty
 * description on failure.
 */
export const extractDescriptionAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const result = await executeLLM<{ description: string }>({
        templateSlug: 'story-generation/extract-asset-description',
        variables: {
          name: data.name,
          type: data.type,
          role: data.role ?? '',
          arc: data.arc ?? '',
          story_context: data.storyContext.slice(0, 10000),
        },
        context: {
          name: 'extract-asset-description',
          accountId: user.id,
        },
      });

      return {
        success: true as const,
        data: { description: result.data.description },
      };
    } catch (err) {
      console.error('[extractDescription] LLM extraction failed:', err);

      return {
        success: true as const,
        data: { description: '' },
      };
    }
  },
  { schema: ExtractDescriptionSchema },
);

/**
 * Links an existing asset to an episode by adding its ID and name
 * to the episode's metadata (character_ids/location_ids arrays).
 * Deduplicates by ID and case-insensitive name.
 */
export const linkAssetToEpisodeAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Fetch current episode metadata
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: fetchError } = await (client as any)
      .from('episodes')
      .select('metadata')
      .eq('id', data.episodeId)
      .single();

    if (fetchError || !episode) {
      throw new Error('Episode not found');
    }

    const metadata = (episode.metadata ?? {}) as Record<string, unknown>;
    const idsKey =
      data.assetType === 'character' ? 'character_ids' : 'location_ids';
    const namesKey =
      data.assetType === 'character' ? 'character_names' : 'location_names';

    const existingIds = (metadata[idsKey] as string[] | undefined) ?? [];
    const existingNames = (metadata[namesKey] as string[] | undefined) ?? [];

    // Dedupe
    const newIds = existingIds.includes(data.assetId)
      ? existingIds
      : [...existingIds, data.assetId];
    const newNames = existingNames.some(
      (n) => n.toLowerCase() === data.assetName.toLowerCase(),
    )
      ? existingNames
      : [...existingNames, data.assetName];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (client as any)
      .from('episodes')
      .update({
        metadata: { ...metadata, [idsKey]: newIds, [namesKey]: newNames },
      })
      .eq('id', data.episodeId);

    if (updateError) {
      throw new Error('Failed to link asset to episode');
    }

    return { success: true as const, data: { linked: true } };
  },
  { schema: LinkAssetToEpisodeSchema },
);

/**
 * Batch-creates assets from sidebar and links them to an episode.
 *
 * Pipeline:
 * 1. Extract descriptions in parallel via LLM
 * 2. Upsert asset rows (ignoreDuplicates for existing names)
 * 3. Fetch all matching assets (including pre-existing duplicates)
 * 4. Link all assets to episode metadata
 */
export const batchCreateUnlinkedAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // 1. Fetch existing assets in this project with matching names
    const allNames = data.items.map((i) => i.name);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingAssets } = await (client as any)
      .from('assets')
      .select('id, name, type')
      .eq('project_id', data.projectId)
      .in('name', allNames)
      .is('deleted_at', null);

    const existingMap = new Map<string, { id: string; name: string; type: string }>();

    for (const a of (existingAssets ?? [])) {
      existingMap.set(`${a.type}:${a.name.toLowerCase()}`, a);
    }

    // 2. Determine which items need to be created
    const itemsToCreate = data.items.filter(
      (item) => !existingMap.has(`${item.type}:${item.name.toLowerCase()}`),
    );

    let newAssets: Array<{ id: string; name: string; type: string }> = [];

    if (itemsToCreate.length > 0) {
      // 3. Extract descriptions in parallel via LLM
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const descriptionResults = await Promise.allSettled(
        itemsToCreate.map(async (item) => {
          try {
            const result = await executeLLM<{ description: string }>({
              templateSlug: 'story-generation/extract-asset-description',
              variables: {
                name: item.name,
                type: item.type,
                role: item.role ?? '',
                arc: item.arc ?? '',
                story_context: data.storyContext.slice(0, 10000),
              },
              context: {
                name: 'batch-extract-description',
                accountId: user.id,
              },
            });

            return result.data.description;
          } catch (err) {
            console.error(`[batchCreate] LLM extraction failed for "${item.name}":`, err);
            return '';
          }
        }),
      );

      // 4. Build asset rows for new items only
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
          metadata: item.role
            ? { role: item.role, autoCreated: true }
            : { autoCreated: true },
        };
      });

      // 5. Insert new assets
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: created, error: insertError } = await (client as any)
        .from('assets')
        .insert(assetRows)
        .select('id, name, type');

      if (insertError) {
        console.error('[batchCreate] Insert failed:', insertError);
        throw new Error('Failed to create assets');
      }

      newAssets = (created ?? []) as Array<{
        id: string;
        name: string;
        type: string;
      }>;
    }

    // 6. Combine: existing (pre-existing in library) + newly created
    const allAssets = [
      ...Array.from(existingMap.values()),
      ...newAssets,
    ];

    // 7. Link all to episode metadata
    if (allAssets.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: episode } = await (client as any)
        .from('episodes')
        .select('metadata')
        .eq('id', data.episodeId)
        .single();

      const metadata = (episode?.metadata ?? {}) as Record<string, unknown>;
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
      await (client as any)
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
    }

    revalidatePath('/', 'layout');

    return {
      success: true as const,
      data: {
        created: newAssets.length,
        linked: existingMap.size,
        failed: data.items.length - newAssets.length - existingMap.size,
      },
    };
  },
  { schema: BatchCreateUnlinkedSchema },
);
