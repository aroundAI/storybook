'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { UpdatePublishNoteSchema } from '../lib/schemas/publish-note.schema';

/**
 * Writes a video's analytics note, with its author and time, in one update.
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
  async ({ publishId, note }, user) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('publishes')
      .update({
        analytics_note: note,
        analytics_note_updated_at: new Date().toISOString(),
        analytics_note_updated_by: user.id,
      })
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
