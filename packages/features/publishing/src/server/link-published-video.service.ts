import 'server-only';

import type { Database } from '@kit/supabase/database';
import type { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { MarkAsExternallyUploadedInput } from '../lib/schemas/upload-only.schema';
import { extractContentId } from '../lib/upload-only-format';

type Client = ReturnType<typeof getSupabaseServerClient<Database>>;

type Log = Parameters<typeof extractContentId>[2];

/**
 * Records that an episode's video is already on a platform (uploaded outside
 * StoryBook), for the publish screen's "Already on YouTube?" link and the
 * MCP link_published_video tool alike (FILM-2202, FILM-2204). Analytics
 * attribute a video to an episode by its platform id, so a video already
 * linked to another live episode is refused: it would be counted twice.
 */
export async function linkPublishedVideo(
  client: Client,
  input: MarkAsExternallyUploadedInput,
  logger: Log,
): Promise<{ ok: true; publishId: string } | { ok: false; refusal: string }> {
  const { episodeId, platform, platformUrl } = input;
  const platformContentId = extractContentId(platformUrl, platform, logger);

  if (platformContentId) {
    const { data: elsewhere, error: duplicateError } = await client
      .from('publishes')
      .select('id, episodes!inner(deleted_at)')
      .eq('platform', platform)
      .eq('platform_content_id', platformContentId)
      .neq('episode_id', episodeId)
      .neq('status', 'deleted')
      .is('episodes.deleted_at', null)
      .limit(1);

    if (duplicateError) {
      throw new Error(`Failed to check the link: ${duplicateError.message}`);
    }

    if (elsewhere?.length) {
      return {
        ok: false,
        refusal:
          'This video is already linked to another episode. Unlink it there first.',
      };
    }
  }

  // Check for existing publish record
  const { data: existingPublish } = await client
    .from('publishes')
    .select('id')
    .eq('episode_id', episodeId)
    .eq('platform', platform)
    .maybeSingle();

  let publishId: string;

  if (existingPublish) {
    // Update existing record
    const { data: updated, error: updateError } = await client
      .from('publishes')
      .update({
        platform_url: platformUrl,
        platform_content_id: platformContentId,
        status: 'published',
        published_at: new Date().toISOString(),
        metadata: { upload_method: 'external' },
      })
      .eq('id', existingPublish.id)
      .select('id')
      .single();

    if (updateError) {
      throw new Error(
        `Failed to update publish record: ${updateError.message}`,
      );
    }

    publishId = updated.id;
  } else {
    // Create new record for external upload (no OAuth connection required)
    // Migration 20251210164448 makes platform_connection_id nullable for external uploads
    // TODO: Remove type override after running `pnpm supabase:web:typegen` to regenerate types
    const { data: created, error: createError } = await client
      .from('publishes')
      .insert({
        episode_id: episodeId,
        platform,
        platform_url: platformUrl,
        platform_content_id: platformContentId,
        // Type override: platform_connection_id is nullable after migration 20251210164448
        // The generated types still show it as required until typegen is run
        platform_connection_id: null as unknown as string,
        status: 'published',
        published_at: new Date().toISOString(),
        metadata: { upload_method: 'external' },
      })
      .select('id')
      .single();

    if (createError) {
      throw new Error(
        `Failed to create publish record: ${createError.message}`,
      );
    }

    publishId = created.id;
  }

  return { ok: true, publishId };
}
