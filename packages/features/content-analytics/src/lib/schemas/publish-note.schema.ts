import { z } from 'zod';

export const PUBLISH_NOTE_MAX_LENGTH = 5000;

/**
 * A per-video analytics note (FILM-1610). Whitespace-only is treated as
 * clearing the note, so a blank field never stores a note that looks empty.
 */
export const UpdatePublishNoteSchema = z.object({
  publishId: z.string().uuid(),
  note: z
    .string()
    .max(PUBLISH_NOTE_MAX_LENGTH)
    .transform((value) => (value.trim().length === 0 ? null : value))
    .nullable(),
});
