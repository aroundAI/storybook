'use server';

import 'server-only';

import { z } from 'zod';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  NOTHING_TO_RESTORE,
  RESTORE_NEEDS_WRITE,
  RESTORE_WHILE_RUN_OPEN,
  STUDIO_PAGES,
  STUDIO_PAGE_STAGES,
  type StudioPage,
  latestStageRevision,
  listOpenExternalRuns,
} from '../lib/stage-runs';

/*
 * Studio actions on generation runs and their revisions (FILM-1910).
 *
 * The spec names packages/features/generation/src/server/run-actions.ts,
 * but @kit/generation is bundled into the LLM worker and its import
 * boundary test forbids `server-only` and Next there; these are Next
 * server actions, so they live beside the studio pages' other actions.
 */

const RestoreRevisionSchema = z.object({
  episodeId: z.string().uuid(),
  page: z.enum(STUDIO_PAGES as [StudioPage, ...StudioPage[]]),
});

/**
 * Puts back the newest `content_revisions` snapshot of the page's stages,
 * through `restore_content_revision` (FILM-1903), which first saves what it
 * replaces as a new revision, so a second restore undoes the first. The
 * page is the input, not a stage list, so a caller cannot reach a stage
 * the page does not show.
 */
export const restoreRevisionAction = returnRefusals(
  enhanceAction(
    async ({ episodeId, page }) => {
      const client = getSupabaseServerClient();
      const { stages, blocks } = STUDIO_PAGE_STAGES[page];

      const open = await listOpenExternalRuns(client, episodeId);

      if (
        open.some((run) => (blocks as readonly string[]).includes(run.stage))
      ) {
        throw new ActionRefusal(RESTORE_WHILE_RUN_OPEN);
      }

      const revision = await latestStageRevision(client, episodeId, stages);

      if (!revision) {
        throw new ActionRefusal(NOTHING_TO_RESTORE);
      }

      const { data: undoRevisionId, error } = await client.rpc(
        'restore_content_revision',
        { p_revision_id: revision.id },
      );

      if (error) {
        if (error.code === '42501')
          throw new ActionRefusal(RESTORE_NEEDS_WRITE);
        if (error.code === 'P0002') throw new ActionRefusal(NOTHING_TO_RESTORE);

        throw new Error(
          `restore_content_revision failed (${error.code}): ${error.message}`,
        );
      }

      return {
        restoredRevisionId: revision.id,
        restoredStage: revision.stage,
        undoRevisionId,
      };
    },
    { schema: RestoreRevisionSchema, auth: true },
  ),
);
