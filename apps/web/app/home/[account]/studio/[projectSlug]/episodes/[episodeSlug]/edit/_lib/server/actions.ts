'use server';

import { revalidatePath } from 'next/cache';

import { closeEditSession } from '@kit/desktop-integration/server';
import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ForceCloseEditSessionSchema } from '../schemas/force-close.schema';

export type ForceCloseResult =
  | { ok: true; restoredStatus: string | null; episodeStatus: string }
  | { ok: false; code: string; message: string };

const REFUSALS: Record<string, string> = {
  FORBIDDEN: 'Only a project owner or admin can close another session.',
  NOT_FOUND: 'That session no longer exists.',
  VALIDATION_FAILED: 'That session has already ended.',
};

/**
 * An admin's force-close of an open StorybookStudio session (FILM-2006):
 * close_edit_session's own logic with reason 'admin', so the function
 * checks the caller is the project's owner or admin and puts the episode's
 * previous status back. Refusals are values: production redacts thrown
 * text from server actions.
 */
export const forceCloseEditSessionAction = enhanceAction(
  async (input): Promise<ForceCloseResult> => {
    const result = await closeEditSession(getSupabaseServerClient(), {
      sessionId: input.sessionId,
      reason: 'admin',
    });

    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        message: REFUSALS[result.code] ?? 'The session could not be closed.',
      };
    }

    revalidatePath(input.path);

    return {
      ok: true,
      restoredStatus: result.restoredStatus,
      episodeStatus: result.episodeStatus,
    };
  },
  { schema: ForceCloseEditSessionSchema },
);
