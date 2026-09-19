'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ActionRefusal } from '../lib/action-result';
import { UpdatePublishNoteSchema } from '../lib/schemas/publish-note.schema';
import { withRefusals } from './with-refusals';

/** What a save reports: stored, or someone else changed the note first. */
export type PublishNoteSaveResult =
  | {
      status: 'saved';
      publishId: string;
      note: string | null;
      updatedAt: string | null;
    }
  | {
      /** Nothing was written; `note` and `updatedAt` are the other edit. */
      status: 'conflict';
      publishId: string;
      note: string | null;
      updatedAt: string | null;
    };

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
 * Compare-and-save (FILM-1615): the update applies only while
 * `analytics_note_updated_at` still reads what the editor loaded. Zero rows
 * then means one of two things, told apart by reading the note back: the
 * caller may edit it and someone else changed it first — a conflict,
 * returned with the other edit so nothing is overwritten unseen — or the
 * caller may not edit it at all.
 *
 * Its own columns, never `publishes.metadata`, which the publish pipeline
 * writes; a read-modify-write there would race it.
 */
export const updatePublishNoteAction = withRefusals(
  'save the note',
  enhanceAction(
    async ({
      publishId,
      note,
      expectedUpdatedAt,
    }): Promise<PublishNoteSaveResult> => {
      const client = getSupabaseServerClient();

      const update = client
        .from('publishes')
        .update({ analytics_note: note })
        .eq('id', publishId);

      const { data, error } = await (
        expectedUpdatedAt === null
          ? update.is('analytics_note_updated_at', null)
          : update.eq('analytics_note_updated_at', expectedUpdatedAt)
      ).select('id, analytics_note, analytics_note_updated_at');

      if (error) {
        throw new Error(`Failed to save the note: ${error.message}`);
      }

      const [saved] = data ?? [];

      if (saved) {
        return {
          status: 'saved',
          publishId: saved.id,
          note: saved.analytics_note,
          updatedAt: saved.analytics_note_updated_at,
        };
      }

      const [current, editable] = await Promise.all([
        client
          .from('publishes')
          .select('analytics_note, analytics_note_updated_at')
          .eq('id', publishId)
          .maybeSingle(),
        client.rpc('editable_publish_ids', { p_publish_ids: [publishId] }),
      ]);

      if (current.error || editable.error) {
        throw new Error(
          `Failed to check the note: ${(current.error ?? editable.error)!.message}`,
        );
      }

      const canEdit = ((editable.data ?? []) as string[]).includes(publishId);

      if (current.data && canEdit) {
        return {
          status: 'conflict',
          publishId,
          note: current.data.analytics_note,
          updatedAt: current.data.analytics_note_updated_at,
        };
      }

      throw new ActionRefusal(
        'You cannot edit notes on this video. Notes can be changed by members of its project.',
      );
    },
    { schema: UpdatePublishNoteSchema, auth: true },
  ),
);
