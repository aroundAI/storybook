import { z } from 'zod';

/**
 * `episodes.edit_state` (FILM-2002): who is editing the episode in
 * StorybookStudio, since when, and what the last delivered edit was. `{}`
 * until the first session; `open_edit_session` writes the session fields
 * and a close or delivery clears them again (`kit.released_edit_state`).
 */
export interface EditState {
  sessionId: string | null;
  editedBy: { userId: string; name: string | null } | null;
  /** When the open session started (ISO 8601). */
  since: string | null;
  lastDeliveredAt: string | null;
  editedIn: 'studio';
  /** The version count of the last delivered edit. */
  versions: number;
}

export const EMPTY_EDIT_STATE: EditState = {
  sessionId: null,
  editedBy: null,
  since: null,
  lastDeliveredAt: null,
  editedIn: 'studio',
  versions: 0,
};

export const EditStateSchema = z.object({
  sessionId: z.string().uuid().nullable().default(null),
  editedBy: z
    .object({ userId: z.string().uuid(), name: z.string().nullable() })
    .nullable()
    .default(null),
  since: z.string().nullable().default(null),
  lastDeliveredAt: z.string().nullable().default(null),
  editedIn: z.literal('studio').default('studio'),
  versions: z.number().int().nonnegative().default(0),
}) satisfies z.ZodType<EditState, z.ZodTypeDef, unknown>;

/** The column as read; anything malformed reads as no edit state. */
export function parseEditState(raw: unknown): EditState {
  const parsed = EditStateSchema.safeParse(raw ?? {});

  return parsed.success ? parsed.data : EMPTY_EDIT_STATE;
}

export const EDIT_SESSION_STATUSES = ['open', 'closed', 'delivered'] as const;

export type EditSessionStatus = (typeof EDIT_SESSION_STATUSES)[number];

/** The episode statuses an edit session may open from; draft and story have nothing to edit. */
export const EDITABLE_EPISODE_STATUSES = [
  'storyboard',
  'generating',
  'ready',
  'published',
] as const;

/**
 * Whether the web shows "Editing in Studio": the episode is editing and its
 * edit_state names an open session. The two change together, in one
 * transaction, in open_edit_session and kit.end_edit_session.
 */
export function isEditingInStudio(episode: {
  status: string;
  edit_state: unknown;
}): boolean {
  return (
    episode.status === 'editing' &&
    parseEditState(episode.edit_state).sessionId !== null
  );
}
