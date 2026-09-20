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
    .max(PUBLISH_NOTE_MAX_LENGTH, 'At most 5,000 characters')
    .transform((value) => (value.trim().length === 0 ? null : value))
    .nullable(),
  /**
   * When the note last changed, as the editor last read it — null for a
   * note never written. The save applies only if it still is, so an edit
   * made in between is reported rather than overwritten (FILM-1615).
   * Compared as the exact string Postgres returned; never through a Date.
   */
  expectedUpdatedAt: z.string().max(64).nullable(),
});

/** The note editor's form: the note alone, with the same rules. */
export const PublishNoteFormSchema = UpdatePublishNoteSchema.pick({
  note: true,
});
