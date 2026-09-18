'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { UpdatePublishNoteSchema } from '../lib/schemas/publish-note.schema';

/**
 * Writes a video's analytics note.
 *
 * Only the note: its author and time are set by the database trigger
 * `publishes_analytics_note_audit`, so a request — through this action or
 * straight to PostgREST — cannot claim another author or an older time.
 *
 * Through the caller's own client, so `publishes_update` decides who may
 * write: owner, admin or member of the publish's project. A refused update
 * is not an error in PostgREST — it matches zero rows and returns 200 — so
 * the row count is checked, or a refusal would be reported as a save.
 *
 * Its own columns, never `publishes.metadata`, which the publish pipeline
 * writes; a read-modify-write there would race it.
 */
export const updatePublishNoteAction = enhanceAction(
  async ({ publishId, note }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('publishes')
      .update({ analytics_note: note })
      .eq('id', publishId)
      .select('id, analytics_note, analytics_note_updated_at');

    if (error) {
      throw new Error(`Failed to save the note: ${error.message}`);
    }

    const [saved] = data ?? [];

    if (!saved) {
      throw new Error(
        'You cannot edit notes on this video. Notes can be changed by members of its project.',
      );
    }

    return {
      publishId: saved.id,
      note: saved.analytics_note,
      updatedAt: saved.analytics_note_updated_at,
    };
  },
  { schema: UpdatePublishNoteSchema, auth: true },
);
