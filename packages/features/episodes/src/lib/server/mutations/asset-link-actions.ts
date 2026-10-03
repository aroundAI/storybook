'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import {
  type AssetDescriptionTarget,
  type Ctx,
  type RunHandle,
  assetDescriptionStage,
  fallbackDescription,
} from '@kit/generation';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { requireAffectedRows, returnRefusals } from '@kit/next/refusals';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { linkAssetsToEpisode } from '../../../server/episode.service';

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
 * One description from the story text (KB-126), as the `asset_description`
 * stage's prepare and the run's write (FILM-1901, FILM-1902): a run is opened
 * on the asset-to-be in the team's mode, the stage renders the prompt, the
 * run writes, and the reply is checked against the stage's output schema.
 * Both actions call this: the single-asset one used to send `role` and
 * `arc`, which the template does not read, and not `type_instructions`,
 * which it requires — so every call threw, was caught, and the sidebar's
 * "extract description" came back empty. Not exported: every export of a
 * 'use server' file is an endpoint (KB-58).
 */
async function describeAsset(
  ctx: Ctx,
  target: AssetDescriptionTarget,
  context: { name: string; accountId: string },
): Promise<{ description: string; run: RunHandle }> {
  const { openRun } = await import('@kit/ai-gateway');
  const stage = assetDescriptionStage;

  const run = await openRun(
    'asset_description',
    {
      type: 'asset',
      // The asset may not exist yet: the run is on the description itself
      id: crypto.randomUUID(),
      accountId: context.accountId,
      projectId: target.projectId ?? null,
      input: { kind: 'stage', target },
    },
    { kind: 'web', name: context.name },
    ctx,
  );

  try {
    const [part] = await stage.parts(ctx, target);
    const brief = await stage.prepare(ctx, target, part!);
    const generated = await run.write(brief);
    const description = stage.outputSchema.parse(generated.output).description;

    return { description, run };
  } catch (error) {
    await run.fail(error).catch(() => undefined);
    throw error;
  }
}

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
      const { description, run } = await describeAsset(
        { client, accountId: user.id, userId: user.id },
        {
          asset: {
            name: data.name,
            type: data.type,
            role: data.role,
            arc: data.arc,
          },
          storyContext: data.storyContext,
        },
        { name: 'extract-asset-description', accountId: user.id },
      );

      // Nothing is saved from the sidebar's extract: the run is complete
      await run.complete();

      return {
        success: true as const,
        data: { description },
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
 * Links an existing asset to an episode (the MCP tool calls the same
 * `linkAssetsToEpisode`; KB-183). The asset's name and type come from its
 * row, and it must belong to the episode's project.
 */
const linkAssetToEpisode = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const result = await linkAssetsToEpisode(client, {
      episodeId: data.episodeId,
      assetIds: [data.assetId],
    });

    if (!result.ok) {
      throw new ActionRefusal(result.message);
    }

    return { success: true as const, data: { linked: true } };
  },
  { schema: LinkAssetToEpisodeSchema },
);

export const linkAssetToEpisodeAction = returnRefusals(linkAssetToEpisode);

/**
 * Batch-creates assets from sidebar and links them to an episode.
 *
 * Pipeline:
 * 1. Extract descriptions in parallel via LLM
 * 2. Upsert asset rows (ignoreDuplicates for existing names)
 * 3. Fetch all matching assets (including pre-existing duplicates)
 * 4. Link all assets to episode metadata
 */
const batchCreateUnlinked = enhanceAction(
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

    const existingMap = new Map<
      string,
      { id: string; name: string; type: string }
    >();

    for (const a of existingAssets ?? []) {
      existingMap.set(`${a.type}:${a.name.toLowerCase()}`, a);
    }

    // 2. Determine which items need to be created
    const itemsToCreate = data.items.filter(
      (item) => !existingMap.has(`${item.type}:${item.name.toLowerCase()}`),
    );

    const newAssets: Array<{ id: string; name: string; type: string }> = [];

    if (itemsToCreate.length > 0) {
      const ctx: Ctx = { client, accountId: user.id, userId: user.id };
      const stage = assetDescriptionStage;
      const targets: AssetDescriptionTarget[] = itemsToCreate.map((item) => ({
        projectId: data.projectId,
        asset: item,
        storyContext: data.storyContext,
      }));

      // 3. Describe in parallel; a failed description still gets an asset
      const described = await Promise.all(
        targets.map(async (target) => {
          try {
            return await describeAsset(ctx, target, {
              name: 'batch-extract-description',
              accountId: user.id,
            });
          } catch (err) {
            console.error(
              `[batchCreate] LLM extraction failed for "${target.asset.name}":`,
              err,
            );

            return {
              description: fallbackDescription(target.asset.type),
              run: null,
            };
          }
        }),
      );

      // 4. Commit each asset row: an upsert on (project_id, type, name), so a
      // soft-deleted asset of the same name is resurrected rather than
      // refused by the unique constraint. The run that wrote the description
      // is the origin the row carries; a fallback description has none.
      for (const [index, target] of targets.entries()) {
        const { description, run } = described[index]!;
        const committed = await stage.commit(
          ctx,
          run?.toGenerationRun() ?? {
            mode: 'server',
            origin: { kind: 'human', at: new Date().toISOString() },
          },
          target,
          [{ description }],
        );

        await run?.complete();
        newAssets.push(committed.data.asset);
      }
    }

    // 6. Combine: existing (pre-existing in library) + newly created
    const allAssets = [...Array.from(existingMap.values()), ...newAssets];

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
      const { data: updated, error: updatedError } = await (client as any)
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
        .eq('id', data.episodeId)
        .select('id');

      if (updatedError) {
        throw new Error(`Failed to update episodes: ${updatedError.message}`);
      }

      requireAffectedRows(updated, "You can't change this episode's assets.");
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

export const batchCreateUnlinkedAction = returnRefusals(batchCreateUnlinked);
