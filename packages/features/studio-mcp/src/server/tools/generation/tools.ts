import 'server-only';

import { z } from 'zod';

import { type McpToolDefinition, defineTool } from '../../../registry';
import { PAGING_NOTE, cursorArg, limitArg } from '../pagination';
import { generationHistory } from './history';
import { BRIEF_MAX_BYTES, SUBMISSION_MAX_BYTES } from './limits';
import {
  GetBriefInput,
  RunIdInput,
  StartGenerationInput,
  SubmitGenerationInput,
} from './schemas';
import { GenerationService, type GenerationToolDeps } from './service';

const KB = 1024;

/**
 * The generation tools of FILM-1908 (EDD "3. MCP tool catalogue",
 * Generate): generic over the stage registry, so a stage registered in
 * `@kit/generation` is startable here with no code of its own. The mode is
 * never an argument: a run opened over MCP is external.
 */
export function createGenerationTools(
  deps: () => GenerationToolDeps,
): McpToolDefinition[] {
  const service = (context: Parameters<McpToolDefinition['handler']>[1]) =>
    new GenerationService(deps(), context);

  const startGeneration = defineTool({
    name: 'start_generation',
    title: 'Start generation',
    description: `Opens a generation run for a stage on its target and returns the brief for the first part: instructions, context, the output JSON Schema, an example, a quality rubric to check your work against, and the constraints StoryBook enforces. You write the output yourself; StoryBook makes no model call for this run. The run holds the target for 30 minutes, renewed by every call on it; a second start on the same target and stage fails with RUN_IN_PROGRESS naming who holds it. Then submit_generation each part, and finalize_generation (a single-part stage such as story finalizes on submit). A brief stays under about ${BRIEF_MAX_BYTES / KB} KB.`,
    inputSchema: StartGenerationInput,
    scope: 'studio:write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    async handler(input, context) {
      const result = await service(context).start(input);

      return {
        text: `Run ${result.run.runId} (${result.run.stage}, external) is open until ${result.run.leaseExpiresAt}. Brief for part ${result.brief.part.key} (${result.brief.part.index + 1} of ${result.brief.part.total}) follows in structuredContent.`,
        structuredContent: result,
      };
    },
  });

  const getBrief = defineTool({
    name: 'get_brief',
    title: 'Get brief',
    description:
      "The brief for one part of an open external run (e.g. 'scene:4'), as start_generation returned the first. Renews the run's lease.",
    inputSchema: GetBriefInput,
    scope: 'studio:write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    async handler(input, context) {
      const result = await service(context).getBrief(
        input.runId,
        input.partKey,
      );

      return {
        text: `Brief for part ${result.brief.part.key} of run ${input.runId}.`,
        structuredContent: result,
      };
    },
  });

  const submitGeneration = defineTool({
    name: 'submit_generation',
    title: 'Submit generation',
    description: `Submits your output for one part. StoryBook validates it with the stage's schema and deterministic checks and stores it with the run, not yet in the episode. Returns {status: 'accepted', next, remaining} with the next part's brief, or {status: 'rejected', errors: [{path, code, message}]}: fix those fields and submit the part again. Submitting an accepted part again replaces it; a refused submission never replaces an accepted one. Repeating an identical call returns the first answer. A single-part stage is committed on acceptance, and the reply carries what finalize_generation would. Up to about ${SUBMISSION_MAX_BYTES / KB} KB per call. Pass model to record what you wrote with (stored as self-reported).`,
    inputSchema: SubmitGenerationInput,
    scope: 'studio:write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    async handler(input, context) {
      const result = await service(context).submit(input);

      const text =
        result.status === 'rejected'
          ? `Part ${result.partKey} refused: ${result.errors
              .map((e) => `${e.path || '<root>'}: ${e.message}`)
              .join('; ')}`
          : 'finalized' in result
            ? `Part ${result.partKey} accepted and the run committed.`
            : `Part ${result.partKey} accepted; ${result.remaining} part(s) remaining${result.next ? `, next ${result.next.partKey}` : ', call finalize_generation'}.`;

      return { text, structuredContent: result };
    },
  });

  const finalizeGeneration = defineTool({
    name: 'finalize_generation',
    title: 'Finalize generation',
    description:
      "Commits every accepted part of the run to the episode, as StoryBook's own generation would: the same writes, a snapshot of what it replaced (restorable from the web), and the origin {kind: external, clientName, model (self-reported)}. Refused with TARGET_CHANGED if the episode was edited since the brief, or VALIDATION_FAILED listing parts not yet accepted. Reports any run the commit chained (for example an asset description), which waits for you. Finalizing a committed run returns it again.",
    inputSchema: RunIdInput,
    scope: 'studio:write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    async handler(input, context) {
      const result = await service(context).finalize(input.runId);

      return {
        text: `Run ${input.runId} ${result.status}${result.children.length > 0 ? `; chained runs: ${result.children.map((c) => `${c.stage} ${c.runId}`).join(', ')}` : ''}.`,
        structuredContent: result,
      };
    },
  });

  const getRun = defineTool({
    name: 'get_run',
    title: 'Get run',
    description:
      'A generation run in either mode: its stage, status, lease, origin, each part as pending, accepted or rejected, any error, and the runs it chained.',
    inputSchema: RunIdInput,
    scope: 'studio:write',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    async handler(input, context) {
      const result = await service(context).getRun(input.runId);

      return {
        text: `Run ${result.run.runId}: ${result.run.stage}, ${result.run.mode}, ${result.run.status}.`,
        structuredContent: result,
      };
    },
  });

  const cancelGeneration = defineTool({
    name: 'cancel_generation',
    title: 'Cancel generation',
    description:
      'Cancels an open run, in either mode, and releases its target; nothing it held is committed. A run already closed is reported as it is.',
    inputSchema: RunIdInput,
    scope: 'studio:write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    async handler(input, context) {
      const result = await service(context).cancel(input.runId);

      return {
        text: result.cancelled
          ? `Run ${input.runId} cancelled.`
          : `Run ${input.runId} was already ${result.run.status}.`,
        structuredContent: result,
      };
    },
  });

  const getGenerationHistory = defineTool({
    name: 'get_generation_history',
    title: 'Get generation history',
    description: `An episode's generation runs, newest first, in either mode: stage, status, origin (server model, or the external client and the model it reported), each submitted part with its validation failures, any error, and the runs each chained. ${PAGING_NOTE}`,
    inputSchema: {
      episodeId: z.string().uuid(),
      limit: limitArg,
      cursor: cursorArg,
    },
    scope: 'studio:read',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    async handler(input, context) {
      const result = await generationHistory(
        context.principal.supabase,
        context.accountId,
        input,
      );

      return {
        text: `${result.runs.length} run(s) for episode ${input.episodeId}.`,
        structuredContent: result,
      };
    },
  });

  return [
    startGeneration,
    getBrief,
    submitGeneration,
    finalizeGeneration,
    getRun,
    cancelGeneration,
    getGenerationHistory,
  ].map((tool) => tool as unknown as McpToolDefinition);
}
