import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@kit/supabase/database';

import type {
  CreateCharacterInput,
  UpdateCharacterInput,
} from '../schemas/character.schema';
import type { CharacterRow, CharacterWithDetails } from '../types';
import { mapRowToCharacterWithDetails } from '../types';

/**
 * The character writes (FILM-202), callable with any Supabase client so the
 * web's server actions and the MCP `upsert_asset` tool (FILM-1905) share one
 * copy of the rules. Each is one call to a database function that writes
 * the asset and its details in one transaction.
 */
export type CharacterWriteResult =
  | { ok: true; data: CharacterWithDetails }
  | { ok: false; refusal: string; field?: 'name' };

const CHARACTER_SELECT = `
        *,
        character_details!asset_id (
          physical_attributes,
          personality,
          element_prompt,
          reference_images,
          elevenlabs_voice_id
        )
      `;

export async function createCharacterWithDetails(
  client: SupabaseClient<Database>,
  data: CreateCharacterInput,
): Promise<CharacterWriteResult> {
  // One call, one transaction: the function inserts the asset and its
  // details and undoes both if the second fails. Deleting the asset here
  // afterwards could not: assets_delete admits only project owners and
  // admins, so a member's failed create left the asset behind (FILM-202).
  const physicalAttributesJson = {
    physicalAttributes: data.physicalAttributes ?? null,
    personalityTraits: data.personalityTraits ?? null,
    clothingStyle: data.clothingStyle ?? null,
    backstory: data.backstory ?? null,
  };

  const { data: assetId, error: createError } = await client.rpc(
    'create_character_with_details',
    {
      p_project_id: data.projectId,
      p_name: data.name,
      p_description: data.description ?? undefined,
      p_physical_attributes: physicalAttributesJson as Json,
      p_personality: data.personality ?? undefined,
      p_element_prompt: data.elementPrompt ?? undefined,
      p_reference_images: data.referenceImages ?? undefined,
      p_elevenlabs_voice_id: data.voiceAssetId ?? undefined,
      p_file_url: data.fileUrl || undefined,
      p_thumbnail_url: data.thumbnailUrl || undefined,
    },
  );

  if (createError || !assetId) {
    if (createError?.message.includes('duplicate key value')) {
      return {
        ok: false,
        refusal: `A character named "${data.name}" already exists in this project. Choose a different name.`,
        field: 'name',
      };
    }

    throw new Error(
      `Failed to create character: ${createError?.message ?? 'no id returned'}`,
    );
  }

  return { ok: true, data: await fetchCharacter(client, assetId, 'created') };
}

export async function updateCharacterWithDetails(
  client: SupabaseClient<Database>,
  data: UpdateCharacterInput,
): Promise<CharacterWriteResult> {
  const assetPatch: Record<string, Json> = {};

  if (data.name !== undefined) assetPatch.name = data.name;
  if (data.description !== undefined) assetPatch.description = data.description;
  if (data.fileUrl !== undefined) assetPatch.file_url = data.fileUrl || null;
  if (data.thumbnailUrl !== undefined)
    assetPatch.thumbnail_url = data.thumbnailUrl || null;

  const attributesPatch: Record<string, Json> = {};

  if (data.physicalAttributes !== undefined)
    attributesPatch.physicalAttributes = data.physicalAttributes;
  if (data.personalityTraits !== undefined)
    attributesPatch.personalityTraits = data.personalityTraits;
  if (data.clothingStyle !== undefined)
    attributesPatch.clothingStyle = data.clothingStyle;
  if (data.backstory !== undefined) attributesPatch.backstory = data.backstory;

  const detailsPatch: Record<string, Json> = {};

  if (data.personality !== undefined)
    detailsPatch.personality = data.personality;
  if (data.elementPrompt !== undefined)
    detailsPatch.element_prompt = data.elementPrompt;
  if (data.referenceImages !== undefined)
    detailsPatch.reference_images = data.referenceImages;
  if (data.voiceAssetId !== undefined)
    detailsPatch.elevenlabs_voice_id = data.voiceAssetId;

  // One call, one transaction: a failed details write no longer leaves the
  // asset change applied (FILM-202).
  const { error: updateError } = await client.rpc(
    'update_character_with_details',
    {
      p_asset_id: data.assetId,
      p_asset_patch: assetPatch,
      p_details_patch: detailsPatch,
      p_attributes_patch: attributesPatch,
    },
  );

  if (updateError) {
    if (updateError.code === '42501') {
      return { ok: false, refusal: "You can't change this character." };
    }

    if (updateError.code === '23505' && data.name !== undefined) {
      return {
        ok: false,
        refusal: `A character named "${data.name}" already exists in this project. Choose a different name.`,
        field: 'name',
      };
    }

    throw new Error(`Failed to update character: ${updateError.message}`);
  }

  return {
    ok: true,
    data: await fetchCharacter(client, data.assetId, 'updated'),
  };
}

async function fetchCharacter(
  client: SupabaseClient<Database>,
  assetId: string,
  after: 'created' | 'updated',
) {
  const { data: character, error } = await client
    .from('assets')
    .select(CHARACTER_SELECT)
    .eq('id', assetId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch ${after} character: ${error.message}`);
  }

  return mapRowToCharacterWithDetails(character as unknown as CharacterRow);
}
