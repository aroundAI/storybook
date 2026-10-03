'use server';

import 'server-only';

import { z } from 'zod';

import { isRunError, loadRun } from '@kit/generation';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CANCEL_NEEDS_WRITE,
  NOTHING_TO_RESTORE,
  RESTORE_NEEDS_WRITE,
  RESTORE_WHILE_RUN_OPEN,
  RUN_ALREADY_FINISHED,
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

const CancelGenerationRunSchema = z.object({
  runId: z.string().uuid(),
});

/**
 * Cancels an open run from the studio banner (FILM-1910), through the run
 * layer: RunHandle.cancel moves it with transition_generation_run, which
 * refuses anyone who cannot drive the run (can_drive_generation_run).
 * Checked here first with that same function, so the refusal is a value
 * the page can show rather than a store error. The run's lease is gone at
 * once; the open page hears the change over Realtime.
 */
export const cancelGenerationRunAction = returnRefusals(
  enhanceAction(
    async ({ runId }, user) => {
      const client = getSupabaseServerClient();

      const { data: row, error } = await client
        .from('generation_runs')
        .select('id, account_id, project_id')
        .eq('id', runId)
        .maybeSingle();

      if (error) {
        throw new Error(`Could not read run ${runId}: ${error.message}`);
      }

      if (!row) throw new ActionRefusal(RUN_ALREADY_FINISHED);

      if (row.project_id) {
        const { data: canDrive, error: driveError } = await client.rpc(
          'can_drive_generation_run',
          { p_account_id: row.account_id, p_project_id: row.project_id },
        );

        if (driveError) {
          throw new Error(
            `can_drive_generation_run failed: ${driveError.message}`,
          );
        }

        if (!canDrive) throw new ActionRefusal(CANCEL_NEEDS_WRITE);
      }

      const run = await loadRun(runId, {
        client,
        accountId: row.account_id,
        userId: user.id,
      });

      if (!run) throw new ActionRefusal(RUN_ALREADY_FINISHED);

      try {
        await run.cancel('cancelled from the studio');
      } catch (cause) {
        if (isRunError(cause, 'RUN_NOT_OPEN')) {
          throw new ActionRefusal(RUN_ALREADY_FINISHED);
        }

        throw cause;
      }

      return { cancelled: true, runId };
    },
    { schema: CancelGenerationRunSchema, auth: true },
  ),
);
