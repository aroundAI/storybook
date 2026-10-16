import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { scheduledProjectJobTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import type { Database } from '@kit/supabase/database';

import type { UnlabelledProject } from './comment-sync';

/**
 * FILM-1733. Opens the server's labelling run for each project with
 * unlabelled comments, as the team's primary owner, and dispatches it to
 * the LLM worker (handlers/comment-labels.ts).
 *
 * A team that has turned server generation off, or has no model or no
 * spend left today, gets no run: its comments wait for its own AI, which
 * reads and labels them through the MCP connector (get_audience_comments,
 * label_audience_comments). A run already open on the project is left to
 * finish. None of these is an error.
 */

type Client = SupabaseClient<Database>;

export type LabellingOutcome =
  | 'dispatched'
  | 'left_for_mcp'
  | 'already_running'
  | 'no_owner'
  | 'failed';

export async function labelCommentsOnServer(
  client: Client,
  projects: readonly UnlabelledProject[],
): Promise<Record<LabellingOutcome, number>> {
  const logger = await getLogger();
  const ctx = { name: 'comment-labelling' };
  const outcomes: Record<LabellingOutcome, number> = {
    dispatched: 0,
    left_for_mcp: 0,
    already_running: 0,
    no_owner: 0,
    failed: 0,
  };

  const { openRunForJob, runRefusalMessage, STAGE_IN_PROGRESS_REFUSAL } =
    await import('@kit/ai-gateway');

  const owners = await primaryOwners(client, [
    ...new Set(projects.map((p) => p.accountId)),
  ]);

  for (const project of projects) {
    const userId = owners.get(project.accountId);

    if (!userId) {
      outcomes.no_owner++;
      continue;
    }

    try {
      const run = await openRunForJob(
        {
          jobType: 'comment-labels',
          userId,
          target: scheduledProjectJobTarget(project),
          payload: {},
          name: 'comment-sync.label',
        },
        { client, accountId: project.accountId, userId },
      );

      await run.dispatch();
      outcomes.dispatched++;
    } catch (error) {
      const refusal = runRefusalMessage(error);

      if (refusal === STAGE_IN_PROGRESS_REFUSAL) {
        outcomes.already_running++;
      } else if (refusal) {
        outcomes.left_for_mcp++;
      } else {
        outcomes.failed++;
        logger.error(
          {
            ...ctx,
            projectId: project.projectId,
            error: error instanceof Error ? error.message : String(error),
          },
          'could not open a labelling run',
        );
      }
    }
  }

  logger.info({ ...ctx, ...outcomes }, 'labelling runs');

  return outcomes;
}

async function primaryOwners(client: Client, accountIds: string[]) {
  if (accountIds.length === 0) return new Map<string, string>();

  const { data, error } = await client
    .from('accounts')
    .select('id, primary_owner_user_id')
    .in('id', accountIds);

  if (error) throw new Error(`Could not read team owners: ${error.message}`);

  return new Map(
    (data ?? []).map((row) => [row.id, row.primary_owner_user_id]),
  );
}
