import 'server-only';

import {
  type CommitPlan,
  type RunCtx,
  type RunHandle,
  openRun,
} from '@kit/generation';

import type { McpToolContext } from '../../../registry';
import { getMcpRequestContext } from '../../../request-context';
import { toRunToolError } from '../generation/run-errors';
import type { EditCommitRequest, EditCommitResult, EditWriter } from './tools';

function editRunCtx(context: McpToolContext): RunCtx {
  const { principal } = context;

  return {
    client: principal.supabase,
    accountId: context.accountId,
    userId: principal.userId,
    // Inside an MCP request this is 'external', and the connection id makes
    // it so in the database too (mcp_runs_are_external)
    runMode: () => getMcpRequestContext()?.mode,
    connectionId: principal.connectionId,
    clientName: principal.clientName,
  };
}

/**
 * FILM-1909: an edit is a stage commit. It opens an external run for the
 * edit's stage on the episode at the version the caller read (a second
 * open run on the same stage is RUN_IN_PROGRESS), then applies the plan
 * through `apply_generation_commit`, which re-checks that version under a
 * lock (TARGET_CHANGED), snapshots what the plan replaces into
 * content_revisions, writes, and commits the run, in one transaction.
 */
export const runLayerEditWriter: EditWriter = {
  async commit(
    request: EditCommitRequest,
    context: McpToolContext,
  ): Promise<EditCommitResult> {
    const ctx = editRunCtx(context);
    let run: RunHandle;

    try {
      run = await openRun(
        request.stage,
        {
          type: 'episode',
          id: request.episodeId,
          accountId: request.accountId,
          projectId: request.projectId,
          input: {
            kind: 'stage',
            target: { episodeId: request.episodeId, edit: request.tool },
          },
          targetVersion: request.targetVersion,
        },
        { kind: 'mcp', name: request.tool },
        ctx,
      );
    } catch (error) {
      throw toRunToolError(error);
    }

    context.setRunId(run.id);

    try {
      const applied = await run.applyCommit(
        request.plan({ ...request.origin, runId: run.id }) as CommitPlan,
        { finalize: true },
      );
      const { data } = await ctx.client
        .from('episodes')
        .select('version')
        .eq('id', request.episodeId)
        .maybeSingle();

      return {
        version: data?.version ?? request.targetVersion + 1,
        runId: run.id,
        revisionId: applied.revisionId,
      };
    } catch (error) {
      // A refused commit wrote nothing; close the run so it holds no lease
      if (run.status === 'briefed' || run.status === 'in_progress') {
        await run.fail(error).catch(() => undefined);
      }

      throw toRunToolError(error);
    }
  },
};
