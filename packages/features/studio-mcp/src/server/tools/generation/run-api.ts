import 'server-only';

import type {
  AnyStageDefinition,
  CommitResult,
  Ctx,
  GenerationMode,
  PerformanceContext,
  StageKey,
  TargetType,
} from '@kit/generation';

/**
 * What the generation tools need from FILM-1903's run layer, as an
 * interface: `RunHandle` satisfies `RunLike`, and `openRun`, `loadRun` and
 * `finalizeRun` satisfy `RunApi`. The tools are written and tested against
 * this, so a test drives them with a fake run and no database.
 */
export interface RunLike {
  readonly id: string;
  readonly accountId: string;
  readonly projectId: string | null;
  readonly stage: StageKey;
  readonly mode: GenerationMode;
  readonly status: string;
  readonly targetType: TargetType;
  readonly targetId: string;
  readonly targetVersion: number | null;
  readonly input: {
    kind: string;
    target?: unknown;
    performanceContext?: PerformanceContext;
  };
  readonly origin: {
    kind: string;
    name: string;
    clientName?: string;
    model?: string;
  };
  readonly connectionId: string | null;
  readonly parentRunId: string | null;
  readonly createdBy: string;
  readonly leaseExpiresAt: string | null;
  readonly error: Record<string, unknown> | null;
  isOpen(now?: Date): boolean;
  renewLease(): Promise<unknown>;
  cancel(reason?: string): Promise<void>;
}

/** The run's target, as `openRun` takes it. */
export interface OpenRunTarget {
  type: TargetType;
  id: string;
  accountId: string;
  projectId: string | null;
  input: {
    kind: 'stage';
    target: unknown;
    performanceContext?: PerformanceContext;
  };
  targetVersion: number | null;
  prompt?: { slug: string; version: number };
}

/**
 * `Ctx` plus FILM-1903's mode seam. `runMode` answers from the MCP request
 * context, and `connectionId` is the MCP connection the database CHECK
 * `mcp_runs_are_external` forces external: the mode is never an argument.
 */
export interface McpRunCtx extends Ctx {
  runMode: () => GenerationMode | undefined;
  connectionId: string;
  clientName: string;
}

export interface FinalizedRun {
  commit: CommitResult;
  children: RunLike[];
}

export interface RunApi {
  open(
    stage: StageKey,
    target: OpenRunTarget,
    origin: { kind: 'mcp'; name: string; clientName?: string },
    ctx: McpRunCtx,
  ): Promise<RunLike>;
  load(runId: string, ctx: McpRunCtx): Promise<RunLike | null>;
  /** Re-checks every part, TARGET_CHANGED, commits, opens follow-ons. */
  finalize(
    run: RunLike,
    ctx: McpRunCtx,
    parts: Array<{ key: string; output: unknown }>,
  ): Promise<FinalizedRun>;
  stage(key: StageKey): AnyStageDefinition;
}
