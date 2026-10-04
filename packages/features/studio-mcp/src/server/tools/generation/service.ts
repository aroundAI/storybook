import 'server-only';

import { createPerformanceReader } from '@kit/content-analytics/server/performance-reader';
import {
  type AnyStageDefinition,
  type Brief,
  type CheckError,
  type CommitResult,
  type EpisodeContextLoader,
  type PartSpec,
  type PerformanceContext,
  type PerformanceReader,
  type StageKey,
  checkWithSchema,
  performanceContextForRun,
} from '@kit/generation';

import { McpToolError } from '../../../errors';
import type { McpToolContext } from '../../../registry';
import { getMcpRequestContext } from '../../../request-context';
import {
  BRIEF_MAX_BYTES,
  assertSubmissionSize,
  jsonBytes,
  submissionHash,
} from './limits';
import {
  type StoredPart,
  acceptedParts,
  readPart,
  readParts,
  storeAcceptedPart,
  storeRejectedPart,
} from './parts-store';
import type { McpRunCtx, RunApi, RunLike } from './run-api';
import { holderOf, toRunToolError } from './run-errors';
import type { BriefRef, SubmitGenerationResult } from './schemas';
import { type StartTargetInput, resolveStageTarget } from './target';

type Client = McpToolContext['principal']['supabase'];

export interface GenerationToolDeps {
  runs: RunApi;
  /**
   * The episode context a stage's prepare and commit read. Supplied by the
   * app (the worker's builder lives beside the Lambda); called without the
   * semantic recall, which is an embedding model call (FR-20).
   */
  episodeContext?: (client: Client) => EpisodeContextLoader;
  /**
   * FILM-1912's past-performance reader on the principal's client; the
   * FILM-1906 services by default, a fake in tests.
   */
  performance?: (client: Client) => PerformanceReader;
}

export function mcpRunCtx(
  context: McpToolContext,
  deps: GenerationToolDeps,
): McpRunCtx {
  const { principal } = context;
  const client = principal.supabase;

  return {
    client,
    accountId: context.accountId,
    userId: principal.userId,
    episodeContext: deps.episodeContext?.(client),
    // Inside an MCP request this is always 'external'; the connection id
    // makes it so in the database as well (mcp_runs_are_external)
    runMode: () => getMcpRequestContext()?.mode,
    connectionId: principal.connectionId,
    clientName: principal.clientName,
  };
}

function briefRef(part: PartSpec): BriefRef {
  return {
    partKey: part.key,
    label: part.label,
    index: part.index,
    total: part.total,
  };
}

/**
 * NFR-5: a brief stays under about 60 KB. When one would not, the parts an
 * agent can do without go first (the example, then the rubric), and the
 * brief says what it left out; the instructions, context and schema stay.
 */
export function fitBrief(brief: Brief) {
  let fitted: Brief & { omitted?: string[] } = brief;
  const omitted: string[] = [];

  for (const field of ['example', 'qualityRubric'] as const) {
    if (jsonBytes(fitted) <= BRIEF_MAX_BYTES) break;

    if (fitted[field] !== undefined) {
      const { [field]: _dropped, ...rest } = fitted;
      fitted = rest as Brief;
      omitted.push(field);
    }
  }

  const bytes = jsonBytes(fitted);

  return {
    ...fitted,
    ...(omitted.length > 0 ? { omitted } : {}),
    bytes,
    ...(bytes > BRIEF_MAX_BYTES ? { overLimit: true } : {}),
  };
}

type PartStatus = 'accepted' | 'rejected' | 'pending';

function partStatus(stored: StoredPart | undefined): PartStatus {
  if (!stored) return 'pending';

  return stored.validation.status === 'accepted' ? 'accepted' : 'rejected';
}

export function runSummary(
  run: RunLike,
  parts?: PartSpec[],
  stored: StoredPart[] = [],
) {
  const byKey = new Map(stored.map((part) => [part.partKey, part]));

  return {
    runId: run.id,
    stage: run.stage,
    mode: run.mode,
    status: run.status,
    open: run.isOpen(),
    targetType: run.targetType,
    targetId: run.targetId,
    targetVersion: run.targetVersion,
    leaseExpiresAt: run.leaseExpiresAt,
    parentRunId: run.parentRunId,
    origin: run.origin,
    error: run.error,
    ...(parts
      ? {
          parts: parts.map((part) => ({
            ...briefRef(part),
            status: partStatus(byKey.get(part.key)),
          })),
        }
      : {}),
  };
}

function childSummary(child: RunLike) {
  return {
    runId: child.id,
    stage: child.stage,
    mode: child.mode,
    status: child.status,
    targetType: child.targetType,
    targetId: child.targetId,
  };
}

/** A commit's data, with any field too large for a tool reply left out. */
function summarizeCommit(commit: CommitResult) {
  const data =
    commit.data && typeof commit.data === 'object'
      ? Object.fromEntries(
          Object.entries(commit.data as Record<string, unknown>).map(
            ([key, value]) => {
              const bytes = jsonBytes(value);

              return [
                key,
                bytes <= 2048
                  ? value
                  : `<${bytes} bytes; read it with get_episode>`,
              ];
            },
          ),
        )
      : commit.data;

  return {
    status: commit.status,
    ...(commit.reason ? { reason: commit.reason } : {}),
    data,
  };
}

export class GenerationService {
  private readonly ctx: McpRunCtx;

  constructor(
    private readonly deps: GenerationToolDeps,
    private readonly context: McpToolContext,
  ) {
    this.ctx = mcpRunCtx(context, deps);
  }

  private get client() {
    return this.context.principal.supabase;
  }

  private performanceReader(): PerformanceReader {
    return (this.deps.performance ?? createPerformanceReader)(this.client);
  }

  private stage(key: StageKey): AnyStageDefinition {
    try {
      return this.deps.runs.stage(key);
    } catch {
      throw new McpToolError(
        'VALIDATION_FAILED',
        `The ${key} stage has no brief: it runs in StoryBook only.`,
        {
          details: {
            errors: [
              {
                path: 'stage',
                code: 'not_registered',
                message: `${key} is not a registered stage`,
              },
            ],
          },
        },
      );
    }
  }

  private async holderName(userId: string): Promise<string | null> {
    // A personal account's id is its user's (best effort: RLS may hide it)
    const { data } = await this.client
      .from('accounts')
      .select('name')
      .eq('id', userId)
      .maybeSingle();

    return data?.name ?? null;
  }

  private async requireRun(runId: string): Promise<RunLike> {
    let run: RunLike | null;

    try {
      run = await this.deps.runs.load(runId, this.ctx);
    } catch (error) {
      throw toRunToolError(error);
    }

    if (!run || run.accountId !== this.context.accountId) {
      throw new McpToolError('NOT_FOUND', 'No such run in your team.', {
        details: { runId },
      });
    }

    this.context.setRunId(run.id);

    return run;
  }

  private requireExternal(run: RunLike, action: string) {
    if (run.mode !== 'external') {
      throw new McpToolError(
        'FORBIDDEN',
        `Run ${run.id} is a server run: StoryBook writes it, so it cannot ${action} over MCP. get_run shows it; cancel_generation releases it.`,
        { details: { runId: run.id, mode: run.mode } },
      );
    }
  }

  private requireOpen(run: RunLike) {
    if (!run.isOpen()) {
      throw new McpToolError(
        'RUN_EXPIRED',
        `Run ${run.id} is ${run.status}${run.status === 'briefed' || run.status === 'in_progress' ? ' and its lease has passed' : ''}. Start a new run with start_generation.`,
        { details: { runId: run.id, status: run.status } },
      );
    }
  }

  private stageTarget(run: RunLike, stage: AnyStageDefinition): unknown {
    const parsed =
      run.input.kind === 'stage'
        ? stage.targetSchema.safeParse(run.input.target)
        : null;

    if (!parsed?.success) {
      throw new McpToolError(
        'INTERNAL',
        `Run ${run.id} does not carry a ${stage.key} target.`,
      );
    }

    return parsed.data;
  }

  private async partsOf(stage: AnyStageDefinition, target: unknown) {
    const parts: PartSpec[] = await stage.parts(this.ctx, target);

    return parts;
  }

  private requirePart(parts: PartSpec[], partKey: string): PartSpec {
    const part = parts.find((candidate) => candidate.key === partKey);

    if (!part) {
      throw new McpToolError(
        'VALIDATION_FAILED',
        `This run has no part "${partKey}". Its parts: ${parts.map((p) => p.key).join(', ')}.`,
        {
          details: {
            errors: [
              {
                path: 'partKey',
                code: 'unknown_part',
                message: `not one of ${parts.map((p) => p.key).join(', ')}`,
              },
            ],
          },
        },
      );
    }

    return part;
  }

  /**
   * The outputs this run has accepted, in part order and parsed as the
   * stage reads them, leaving out the part being briefed: what `prepare`
   * takes as `earlier` (KB-178: a shots scene reads the reel_scout part).
   */
  private earlier(
    stage: AnyStageDefinition,
    parts: PartSpec[],
    accepted: Map<string, unknown>,
    current: PartSpec,
  ): unknown[] {
    return parts
      .filter((part) => part.key !== current.key && accepted.has(part.key))
      .map((part) =>
        checkWithSchema(stage.outputSchema, accepted.get(part.key)),
      )
      .flatMap((checked) => (checked.ok ? [checked.value] : []));
  }

  private async acceptedOutputs(runId: string) {
    const stored = (await readParts(this.client, [runId])).get(runId) ?? [];

    return new Map(
      acceptedParts(stored).map((part) => [part.partKey, part.output]),
    );
  }

  /**
   * `prepare` with the run's performance block (FILM-1912): the block the
   * run was opened with, so every brief of a run reads the same one.
   */
  private prepare(
    stage: AnyStageDefinition,
    target: unknown,
    part: PartSpec,
    earlier: unknown[] = [],
    performanceContext?: PerformanceContext,
  ): Promise<Brief> {
    return stage.prepare(
      { ...this.ctx, performanceContext },
      target,
      part,
      earlier,
    );
  }

  private async brief(
    run: RunLike,
    stage: AnyStageDefinition,
    target: unknown,
    part: PartSpec,
    earlier: unknown[] = [],
  ) {
    const brief = await this.prepare(
      stage,
      target,
      part,
      earlier,
      run.input.performanceContext,
    );

    return fitBrief({
      ...brief,
      runId: run.id,
      expiresAt: run.leaseExpiresAt ?? brief.expiresAt,
    });
  }

  /**
   * `originName` is the tool that opened the run: `regenerate_shots`
   * (FILM-2007) opens a shots run scoped to some shots through here.
   */
  async start(
    input: { stage: StageKey } & StartTargetInput,
    originName = 'start_generation',
  ) {
    const stage = this.stage(input.stage);
    const { target, runTarget } = await resolveStageTarget(
      this.client,
      {
        accountId: this.context.accountId,
        userId: this.context.principal.userId,
      },
      stage,
      input,
    );

    const parts = await this.partsOf(stage, target);
    const first = parts[0];

    if (!first) {
      throw new McpToolError(
        'INTERNAL',
        `The ${stage.key} stage has no parts.`,
      );
    }

    // FILM-1912: built once, before the first brief, and stored on the run
    // below, so later briefs read it from the run rather than again
    const performanceContext = await performanceContextForRun(
      this.ctx,
      this.performanceReader(),
      { stage: stage.key, projectId: runTarget.projectId },
    );

    const brief = await this.prepare(
      stage,
      target,
      first,
      [],
      performanceContext,
    );

    let run: RunLike;

    try {
      run = await this.deps.runs.open(
        stage.key,
        {
          ...runTarget,
          input: performanceContext
            ? { ...runTarget.input, performanceContext }
            : runTarget.input,
          targetVersion: brief.targetVersion ?? runTarget.targetVersion,
          prompt: { slug: brief.prompt.slug, version: brief.prompt.version },
        },
        {
          kind: 'mcp',
          name: originName,
          clientName: this.context.principal.clientName,
        },
        this.ctx,
      );
    } catch (error) {
      const holder = holderOf(error);
      const name = holder ? await this.holderName(holder.createdBy) : null;

      throw toRunToolError(error, name);
    }

    this.context.setRunId(run.id);

    return {
      run: runSummary(run, parts),
      brief: fitBrief({
        ...brief,
        runId: run.id,
        expiresAt: run.leaseExpiresAt ?? brief.expiresAt,
      }),
    };
  }

  async getBrief(runId: string, partKey: string) {
    const run = await this.requireRun(runId);
    this.requireExternal(run, 'take a brief');
    this.requireOpen(run);

    await run.renewLease();

    const stage = this.stage(run.stage);
    const target = this.stageTarget(run, stage);
    const parts = await this.partsOf(stage, target);
    const part = this.requirePart(parts, partKey);
    const accepted = await this.acceptedOutputs(run.id);

    return {
      brief: await this.brief(
        run,
        stage,
        target,
        part,
        this.earlier(stage, parts, accepted, part),
      ),
    };
  }

  async submit(input: {
    runId: string;
    partKey: string;
    output?: unknown;
    model?: string;
  }) {
    assertSubmissionSize(input.output);

    const run = await this.requireRun(input.runId);
    this.requireExternal(run, 'take a submission');

    const hash = submissionHash(input.output, input.model);
    const previous = await readPart(this.client, run.id, input.partKey);
    const stage = this.stage(run.stage);
    const target = this.stageTarget(run, stage);
    const parts = await this.partsOf(stage, target);
    const singlePart = parts.length === 1;

    // NFR-6: the same output for the same part returns the first answer
    if (
      previous?.validation.status === 'accepted' &&
      previous.validation.hash === hash &&
      previous.validation.result
    ) {
      const first = previous.validation.result;

      if (run.status === 'committed') {
        return {
          ...first,
          replayed: true,
          finalized: { runId: run.id, status: run.status },
        };
      }

      this.requireOpen(run);

      if (singlePart) {
        return {
          ...first,
          replayed: true,
          finalized: await this.finalizeRun(run),
        };
      }

      return { ...first, replayed: true };
    }

    this.requireOpen(run);

    const part = this.requirePart(parts, input.partKey);
    const errors = await this.validate(stage, target, part, input.output);

    if (errors.length > 0) {
      const outcome = await storeRejectedPart(this.client, {
        runId: run.id,
        partKey: part.key,
        output: input.output,
        hash,
        errors,
      });

      if (!outcome.ok) this.closedDuringCall(run, outcome.status);

      const rejected: SubmitGenerationResult = {
        status: 'rejected',
        partKey: part.key,
        errors,
      };

      return rejected;
    }

    const accepted = await this.acceptedOutputs(run.id);
    accepted.set(part.key, input.output);

    const pending = parts.filter((candidate) => !accepted.has(candidate.key));
    const next = pending[0] ?? null;

    const result: SubmitGenerationResult = {
      status: 'accepted',
      partKey: part.key,
      next: next ? briefRef(next) : null,
      remaining: pending.length,
    };

    const outcome = await storeAcceptedPart(this.client, {
      runId: run.id,
      partKey: part.key,
      output: input.output,
      hash,
      model: input.model,
      result,
    });

    if (!outcome.ok) this.closedDuringCall(run, outcome.status);

    // Single-part stages finalize on submit (EDD "2. Generation runs")
    if (singlePart) {
      return { ...result, finalized: await this.finalizeRun(run) };
    }

    if (next) {
      return {
        ...result,
        nextBrief: await this.brief(
          run,
          stage,
          target,
          next,
          this.earlier(stage, parts, accepted, next),
        ),
      };
    }

    return result;
  }

  private closedDuringCall(run: RunLike, status?: string): never {
    throw new McpToolError(
      'RUN_EXPIRED',
      `Run ${run.id} closed (${status ?? 'gone'}) before the part was stored. Start a new run with start_generation.`,
      { details: { runId: run.id, status } },
    );
  }

  /** Schema first, then the stage's deterministic checks (FILM-1901). */
  private async validate(
    stage: AnyStageDefinition,
    target: unknown,
    part: PartSpec,
    output: unknown,
  ): Promise<CheckError[]> {
    const checked = checkWithSchema(stage.outputSchema, output);

    if (!checked.ok) return checked.errors;

    const errors: CheckError[] = await stage.check(
      this.ctx,
      target,
      checked.value,
      part,
    );

    return errors;
  }

  async finalize(runId: string) {
    const run = await this.requireRun(runId);
    this.requireExternal(run, 'be finalized');

    if (run.status === 'committed') {
      return {
        status: 'committed' as const,
        alreadyCommitted: true,
        run: runSummary(run),
        children: (await this.childrenOf(run.id)).map(childSummary),
      };
    }

    this.requireOpen(run);

    return this.finalizeRun(run);
  }

  private async childrenOf(runId: string) {
    const { data } = await this.client
      .from('generation_runs')
      .select('id')
      .eq('parent_run_id', runId)
      .order('created_at');

    const children: RunLike[] = [];

    for (const row of data ?? []) {
      const child = await this.deps.runs.load(row.id, this.ctx);
      if (child) children.push(child);
    }

    return children;
  }

  private async finalizeRun(run: RunLike) {
    const stage = this.stage(run.stage);
    const target = this.stageTarget(run, stage);
    const parts = await this.partsOf(stage, target);
    const stored = (await readParts(this.client, [run.id])).get(run.id) ?? [];
    const accepted = new Map(
      acceptedParts(stored).map((part) => [part.partKey, part]),
    );

    // Refused here rather than in the run layer, which would fail the run:
    // a premature finalize leaves the run open for the missing parts
    const missing = parts.filter((part) => !accepted.has(part.key));

    if (missing.length > 0) {
      throw new McpToolError(
        'VALIDATION_FAILED',
        `Submit ${missing.map((p) => p.key).join(', ')} before finalizing.`,
        {
          details: {
            missing: missing.map(briefRef),
            errors: missing.map((part) => ({
              path: `parts.${part.key}`,
              code: 'missing',
              message: 'Not submitted, or its last submission was refused',
            })),
          },
        },
      );
    }

    let finalized;

    try {
      finalized = await this.deps.runs.finalize(
        run,
        this.ctx,
        parts.map((part) => ({
          key: part.key,
          output: accepted.get(part.key)!.output,
        })),
      );
    } catch (error) {
      throw toRunToolError(error);
    }

    return {
      status: finalized.commit.status,
      run: runSummary(run, parts, stored),
      commit: summarizeCommit(finalized.commit),
      origin: {
        kind: 'external' as const,
        clientName: run.origin.clientName ?? this.context.principal.clientName,
        model: run.origin.model ?? null,
        modelSelfReported: true,
      },
      children: finalized.children.map(childSummary),
    };
  }

  async getRun(runId: string) {
    const run = await this.requireRun(runId);
    const stored = (await readParts(this.client, [run.id])).get(run.id) ?? [];
    let parts: PartSpec[] | undefined;

    if (run.input.kind === 'stage') {
      try {
        const stage = this.stage(run.stage);
        parts = await this.partsOf(stage, this.stageTarget(run, stage));
      } catch {
        parts = undefined;
      }
    }

    return {
      run: runSummary(run, parts, stored),
      children: (await this.childrenOf(run.id)).map(childSummary),
    };
  }

  async cancel(runId: string) {
    const run = await this.requireRun(runId);

    if (!run.isOpen()) {
      return { cancelled: false, run: runSummary(run) };
    }

    try {
      await run.cancel(
        `cancelled over MCP by ${this.context.principal.clientName}`,
      );
    } catch (error) {
      throw toRunToolError(error);
    }

    return { cancelled: true, run: runSummary(run) };
  }
}
