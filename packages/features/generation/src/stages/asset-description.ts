/**
 * asset_description: describe one character or location from story text,
 * for portrait or environment image generation.
 *
 * Target: the asset by (project, type, name), which may not exist yet, and
 * the text to read it from. Commit: upsert the `assets` row on
 * (project_id, type, name) with the description and `metadata.autoCreated`,
 * resurrecting a soft-deleted row of the same name, as the LLM worker's
 * asset-creation job and the sidebar's batch-create action both did
 * (FILM-1901). Preparing without a project is allowed: the sidebar's
 * "extract description" returns the text without creating anything.
 */
import { z } from 'zod';

import extractAssetDescriptionPrompt from '@kit/prompt-engine/prompts/story-generation/extract-asset-description.json';
import { sanitizeForPrompt } from '@kit/shared/prompt-sanitiser';
import type { Json } from '@kit/supabase/database';

import { type PromptFile, buildBrief, singlePart } from '../brief';
import { registerStage } from '../registry';
import type {
  CheckError,
  CommitResult,
  Ctx,
  GenerationRun,
  PartSpec,
  StageDefinition,
} from '../types';

const PROMPT = extractAssetDescriptionPrompt as PromptFile;

/** The most story text one description is read from */
export const ASSET_DESCRIPTION_CONTEXT_CHARS = 10000;

export const CHARACTER_INSTRUCTIONS =
  'Write a 4-6 sentence description including: Physical appearance (approximate age, ethnicity/skin tone, build, hair color/style, eye color, distinguishing features like scars or tattoos). Clothing and style (what they wear in this story). Demeanor and expression (how they carry themselves, typical body language). Their role and significance. Be specific — commit to physical details based on what the text states or implies from the setting/time period.';

export const LOCATION_INSTRUCTIONS =
  'Write a 3-5 sentence description including: Physical environment (size, architecture, materials, colors, lighting). Atmosphere and mood (sounds, smells, temperature). Notable features (landmarks, furniture, natural elements). How this place functions in the story. Be vivid and specific for environment concept art generation.';

export const AssetDescriptionTargetSchema = z.object({
  /** Required to commit; a brief alone needs none */
  projectId: z.string().uuid().optional(),
  asset: z.object({
    name: z.string().min(1).max(255),
    type: z.enum(['character', 'location']),
    role: z.string().optional(),
    arc: z.string().optional(),
  }),
  storyContext: z.string(),
});

export type AssetDescriptionTarget = z.infer<
  typeof AssetDescriptionTargetSchema
>;

export const AssetDescriptionOutputSchema = z.object({
  description: z.string().trim().min(1),
});

export type AssetDescriptionOutput = z.output<
  typeof AssetDescriptionOutputSchema
>;

export interface AssetDescriptionData {
  asset: { id: string; name: string; type: string };
}

/** What a failed or empty description is saved as, so the asset still exists */
export function fallbackDescription(type: 'character' | 'location'): string {
  return `${type === 'character' ? 'Character' : 'Location'} from story`;
}

async function parts(): Promise<PartSpec[]> {
  return [singlePart('description', 'The description')];
}

async function prepare(
  _ctx: Ctx,
  target: AssetDescriptionTarget,
  part: PartSpec,
) {
  const { asset } = target;
  const extraParts: string[] = [];

  if (asset.role) extraParts.push(`Known role: ${asset.role}`);
  if (asset.arc) extraParts.push(`Character arc: ${asset.arc}`);

  const storyContext = sanitizeForPrompt(target.storyContext).slice(
    0,
    ASSET_DESCRIPTION_CONTEXT_CHARS,
  );

  return buildBrief({
    stage: 'asset_description',
    part,
    prompt: PROMPT,
    variables: {
      // The asset keeps its name as written; the model sees it defused
      name: sanitizeForPrompt(asset.name),
      type: asset.type,
      extra_context: sanitizeForPrompt(extraParts.join('. ')),
      type_instructions:
        asset.type === 'character'
          ? CHARACTER_INSTRUCTIONS
          : LOCATION_INSTRUCTIONS,
      story_context: storyContext,
    },
    context: {
      asset,
      projectId: target.projectId,
      storyContext,
    },
    outputSchema: AssetDescriptionOutputSchema,
    constraints: {
      description: 'required, not blank',
      sentences: asset.type === 'character' ? '4 to 6' : '3 to 5',
    },
    targetVersion: null,
  });
}

async function check(
  _ctx: Ctx,
  _target: AssetDescriptionTarget,
  out: AssetDescriptionOutput,
): Promise<CheckError[]> {
  // `assets.description` is unbounded text; the schema already refuses a
  // blank one. Nothing else about a description is deterministic.
  return out.description.length === 0
    ? [{ path: 'description', code: 'empty', message: 'Blank description' }]
    : [];
}

async function commit(
  ctx: Ctx,
  run: GenerationRun,
  target: AssetDescriptionTarget,
  outputs: AssetDescriptionOutput[],
): Promise<CommitResult<AssetDescriptionData>> {
  const output = outputs[0];

  if (!output) throw new Error('asset_description commit needs one part');

  if (!target.projectId) {
    throw new Error('asset_description commit needs target.projectId');
  }

  const { asset } = target;

  const { data, error } = await ctx.client
    .from('assets')
    .upsert(
      {
        project_id: target.projectId,
        type: asset.type,
        name: asset.name,
        description: output.description,
        metadata: asset.role
          ? { role: asset.role, autoCreated: true }
          : { autoCreated: true },
        deleted_at: null,
        // Who wrote the description (FILM-1903); the column exists since
        // part A, so `originColumnsAvailable` is the caller's say
        ...(ctx.originColumnsAvailable
          ? { generation_origin: run.origin as unknown as Json }
          : {}),
      },
      { onConflict: 'project_id,type,name', ignoreDuplicates: false },
    )
    .select('id, name, type')
    .single();

  if (error || !data) {
    ctx.log?.(`[Asset Description] Upsert failed: ${error?.message}`);
    throw new Error('Failed to create assets');
  }

  return { status: 'committed', data: { asset: data } };
}

export const assetDescriptionStage: StageDefinition<
  AssetDescriptionTarget,
  AssetDescriptionOutput,
  AssetDescriptionData
> = registerStage({
  key: 'asset_description',
  targetType: 'asset',
  targetSchema: AssetDescriptionTargetSchema,
  outputSchema: AssetDescriptionOutputSchema,
  parts,
  prepare,
  check,
  commit,
});
