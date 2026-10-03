import 'server-only';

import { z } from 'zod';

import { AssetTypeSchema } from '@kit/assets/schemas';
import {
  type AssetRow,
  type CharacterRow,
  mapRowToAsset,
  mapRowToCharacterWithDetails,
} from '@kit/assets/types';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import {
  OffsetCursor,
  PAGING_NOTE,
  cursorArg,
  decodeCursor,
  encodeCursor,
  limitArg,
  pageOf,
} from '../pagination';
import { requireProjectInAccount } from './scope';

/** The columns list_assets reads; characters carry their details row. */
export const ASSET_COLUMNS = `*, character_details!asset_id (physical_attributes, personality, element_prompt, reference_images, elevenlabs_voice_id)`;

export function assetSummary(row: AssetRow & Partial<CharacterRow>) {
  if (row.type === 'character') {
    return mapRowToCharacterWithDetails(row as CharacterRow);
  }

  return mapRowToAsset(row);
}

export const listAssetsTool = defineTool({
  name: 'list_assets',
  title: 'List assets',
  description: `A project's characters and locations with their descriptions and details (a character's physical attributes, personality, clothing, backstory and element prompt; a location's setting, time of day, weather and atmosphere), in name order. Other asset types (prop, voice, music, sfx) on request. ${PAGING_NOTE}`,
  inputSchema: {
    projectId: z
      .string()
      .uuid()
      .describe('The project id (from list_projects).'),
    type: AssetTypeSchema.optional().describe(
      'Only this type. Default: characters and locations.',
    ),
    cursor: cursorArg,
    limit: limitArg,
  },
  scope: 'studio:read',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireProjectInAccount(client, context.accountId, input.projectId);

    const types = input.type ? [input.type] : ['character', 'location'];
    const offset = decodeCursor(input.cursor, OffsetCursor)?.offset ?? 0;

    const { data, error } = await client
      .from('assets')
      .select(ASSET_COLUMNS)
      .eq('project_id', input.projectId)
      .in('type', types)
      .is('deleted_at', null)
      .order('name', { ascending: true })
      .order('id')
      .range(offset, offset + input.limit);

    if (error) {
      throw new McpToolError('INTERNAL', 'Could not list the assets.');
    }

    const { items, hasMore } = pageOf(
      (data ?? []) as unknown as Array<AssetRow & Partial<CharacterRow>>,
      input.limit,
    );
    const assets = items.map(assetSummary);

    return {
      text: `${assets.length} ${types.join('/')} asset${assets.length === 1 ? '' : 's'}${hasMore ? ' (more follow)' : ''}: ${assets.map((a) => `${a.type} "${a.name}"`).join(', ') || 'none'}.`,
      structuredContent: {
        projectId: input.projectId,
        types,
        assets,
        nextCursor: hasMore
          ? encodeCursor({ offset: offset + input.limit })
          : null,
      },
    };
  },
});
