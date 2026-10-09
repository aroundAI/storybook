import { z } from 'zod';

import { MAX_SCRIPT_CHARS } from '../script-import';

/**
 * FILM-2205: the new-episode dialog's one form. How the episode starts
 * decides what else it needs: nothing for an idea, the script for a
 * script, nothing for a finished video (it is attached on Publish). Shared
 * by the dialog, the server action and MCP.
 */
const base = z.object({
  projectId: z.string().uuid(),
  /** A season of the project, or null for Unsorted */
  seasonId: z.string().uuid().nullable(),
  title: z.string().trim().min(1, 'Give the episode a title').max(255),
  description: z.string().max(2000).optional(),
});

const NO_SCRIPT = 'Paste the script, or choose a file';

// A field never typed in is absent, not empty: both say what to do
const script = z
  .string({ required_error: NO_SCRIPT })
  .trim()
  .min(1, NO_SCRIPT)
  .max(MAX_SCRIPT_CHARS);

export const START_FROM = ['idea', 'script', 'video'] as const;

export type StartFrom = (typeof START_FROM)[number];

export const CreateEpisodeStartSchema = z.discriminatedUnion('startFrom', [
  base.extend({
    startFrom: z.literal('idea'),
    /** FILM-2206: the episode of this project it follows up */
    followUpOf: z.string().uuid().optional(),
  }),
  base.extend({
    startFrom: z.literal('script'),
    script,
  }),
  base.extend({ startFrom: z.literal('video') }),
]);

export type CreateEpisodeStartInput = z.infer<typeof CreateEpisodeStartSchema>;

/** The stages each start skips, and the stage the episode opens on */
export const START_PLAN: Record<
  StartFrom,
  {
    skipped: Array<'ideation' | 'story' | 'screenplay' | 'shots' | 'audio'>;
    landing: 'ideation' | 'screenplay' | 'publish';
  }
> = {
  idea: { skipped: [], landing: 'ideation' },
  script: { skipped: ['ideation', 'story'], landing: 'screenplay' },
  video: {
    skipped: ['ideation', 'story', 'screenplay', 'shots', 'audio'],
    landing: 'publish',
  },
};

/** FILM-2205: a finished script stored as an existing episode's screenplay */
export const ImportScreenplaySchema = z.object({
  episodeId: z.string().uuid(),
  version: z.number().int().positive(),
  script,
});

/** FILM-2206: what a follow-up would carry, read before it is created */
export const FollowUpPreviewSchema = z.object({
  projectId: z.string().uuid(),
  episodeId: z.string().uuid(),
});

export type ImportScreenplayInput = z.infer<typeof ImportScreenplaySchema>;
