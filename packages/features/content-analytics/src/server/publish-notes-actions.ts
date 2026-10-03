'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { UpdatePublishNoteSchema } from '../lib/schemas/publish-note.schema';
import { updatePublishNoteService } from './publish-notes-service';
import { withRefusals } from './with-refusals';

/**
 * Writes a video's analytics note: the cookie-session wrapper over
 * `updatePublishNoteService` (FILM-1906), which holds the compare-and-save
 * and the refusal.
 */
export const updatePublishNoteAction = withRefusals(
  'save the note',
  enhanceAction(
    async (input) => updatePublishNoteService(getSupabaseServerClient(), input),
    { schema: UpdatePublishNoteSchema, auth: true },
  ),
);
