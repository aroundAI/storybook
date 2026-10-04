import 'server-only';

import { z } from 'zod';

import {
  CharacterFormSchema,
  CreateCharacterSchema,
  UpdateCharacterSchema,
} from '@kit/assets/character-schemas';
import {
  createCharacterWithDetails,
  updateCharacterWithDetails,
} from '@kit/assets/character/service';
import { CreateAssetSchema, UpdateAssetSchema } from '@kit/assets/schemas';
import {
  LocationDetailsSchema,
  LocationFormSchema,
} from '@kit/assets/schemas/location';
import { insertAsset, updateAssetRow } from '@kit/assets/service';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import { requireProjectInAccount } from '../read/scope';
import { compact, parseWith, refused } from '../validation';

/** The character editor's detail fields, minus the base asset fields the tool takes flat. */
const CharacterDetailsSchema = CharacterFormSchema.pick({
  physicalAttributes: true,
  personality: true,
  personalityTraits: true,
  clothingStyle: true,
  backstory: true,
  elementPrompt: true,
  referenceImages: true,
  voiceAssetId: true,
});

interface ExistingAsset {
  id: string;
  type: string;
  name: string;
  project_id: string;
  metadata: unknown;
}

export const upsertAssetTool = defineTool({
  name: 'upsert_asset',
  title: 'Create or update a character or location',
  description:
    'Creates or updates a character or a location in a project, validated as the character and location editors are (name 1-255 characters, description up to 1000). Pass assetId to update that asset; without it, an asset of the same type and name in the project is updated, otherwise one is created. Character details: physicalAttributes, personality, personalityTraits, clothingStyle, backstory, elementPrompt, referenceImages, voiceAssetId. Location details: setting, timeOfDay, weather, atmosphere, referenceImages. Details given replace those fields; others are kept.',
  inputSchema: {
    projectId: z
      .string()
      .uuid()
      .describe('The project id (from list_projects).'),
    type: z.enum(['character', 'location']),
    assetId: z
      .string()
      .uuid()
      .optional()
      .describe('An existing asset to update (from list_assets).'),
    name: CharacterFormSchema.shape.name,
    description: z.string().max(1000).optional(),
    fileUrl: z.string().url().optional().describe('A reference image URL.'),
    thumbnailUrl: z.string().url().optional(),
    character: CharacterDetailsSchema.optional().describe(
      'Character details; only with type character.',
    ),
    location: LocationDetailsSchema.optional().describe(
      'Location details; only with type location.',
    ),
  },
  scope: 'studio:write',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireProjectInAccount(client, context.accountId, input.projectId);

    if (input.type === 'character' && input.location) {
      throw refused('location details do not apply to a character', 'location');
    }

    if (input.type === 'location' && input.character) {
      throw refused(
        'character details do not apply to a location',
        'character',
      );
    }

    const existing = await findExisting(client, input);
    const base = compact({
      name: input.name,
      description: input.description,
      fileUrl: input.fileUrl,
      thumbnailUrl: input.thumbnailUrl,
    });

    if (input.type === 'character') {
      const details = compact(input.character ?? {});
      const result = existing
        ? await updateCharacterWithDetails(
            client,
            parseWith(UpdateCharacterSchema, {
              assetId: existing.id,
              ...base,
              ...details,
            }),
          )
        : await createCharacterWithDetails(
            client,
            parseWith(CreateCharacterSchema, {
              projectId: input.projectId,
              ...base,
              ...details,
            }),
          );

      if (!result.ok) throw refused(result.refusal, result.field);

      return done(existing ? 'updated' : 'created', result.data);
    }

    // The location editor validates the flat form, then stores the detail
    // fields in assets.metadata.
    const form = parseWith(LocationFormSchema, {
      ...base,
      ...compact(input.location ?? {}),
    });
    const details = compact({
      setting: form.setting,
      timeOfDay: form.timeOfDay,
      weather: form.weather,
      atmosphere: form.atmosphere,
      referenceImages: form.referenceImages,
    });

    const result = existing
      ? await updateAssetRow(
          client,
          parseWith(UpdateAssetSchema, {
            id: existing.id,
            ...base,
            metadata: {
              ...((existing.metadata as Record<string, unknown> | null) ?? {}),
              ...details,
            },
          }),
        )
      : await insertAsset(
          client,
          parseWith(CreateAssetSchema, {
            projectId: input.projectId,
            type: 'location',
            ...base,
            metadata: details,
          }),
        );

    if (!result.ok) throw refused(result.refusal, result.field);

    return done(existing ? 'updated' : 'created', result.data);
  },
});

function done(
  action: 'created' | 'updated',
  asset: { id: string; type: string; name: string },
) {
  return {
    text: `${action === 'created' ? 'Created' : 'Updated'} ${asset.type} "${asset.name}" (${asset.id}).`,
    structuredContent: { action, asset },
  };
}

/**
 * The asset to update: the one named by `assetId`, which must be of the
 * given type in the given project, or else the live asset of that type and
 * name, which the database keeps unique per project.
 */
async function findExisting(
  client: Parameters<typeof insertAsset>[0],
  input: { projectId: string; type: string; assetId?: string; name: string },
): Promise<ExistingAsset | null> {
  let query = client
    .from('assets')
    .select('id, type, name, project_id, metadata')
    .eq('project_id', input.projectId)
    .eq('type', input.type)
    .is('deleted_at', null);

  query = input.assetId
    ? query.eq('id', input.assetId)
    : query.eq('name', input.name);

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new McpToolError('INTERNAL', 'Could not look the asset up.');
  }

  if (input.assetId && !data) {
    throw new McpToolError(
      'NOT_FOUND',
      `No live ${input.type} with this id in the project.`,
      { details: { assetId: input.assetId } },
    );
  }

  return (data as ExistingAsset | null) ?? null;
}
