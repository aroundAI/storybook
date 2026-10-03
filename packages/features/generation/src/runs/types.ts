/**
 * The run layer's types (FILM-1903). A run is one stage execution with a
 * mode fixed at creation; `openRun` is its only constructor and the handle
 * is how the worker, a server action or an MCP tool drives it.
 */
import { z } from 'zod';

import type { LlmJobType } from '@kit/prompt-engine/llm-job-payloads';

import type {
  Brief,
  Ctx,
  GenerateResult,
  GenerationMode,
  StageKey,
  TargetType,
} from '../types';
import type { RunHandle } from './run-handle';

export const RunStatusSchema = z.enum([
  'briefed',
  'in_progress',
  'committed',
  'failed',
  'cancelled',
  'expired',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const OPEN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'briefed',
  'in_progress',
]);

/** The lease every call on a run renews. */
export const LEASE_MS = 30 * 60 * 1000;

/**
 * What a run was asked to do, stored in `generation_runs.input`. A
 * registered stage carries its target; a worker job not yet on the
 * generation core carries the LLM job the worker runs for it.
 */
export const RunInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stage'), target: z.unknown() }),
  z.object({
    kind: z.literal('job'),
    jobType: z.string(),
    payload: z.record(z.unknown()),
  }),
]);

export type RunInput =
  | { kind: 'stage'; target: unknown }
  | { kind: 'job'; jobType: LlmJobType; payload: Record<string, unknown> };

/** Where a run was opened from, stored in `generation_runs.origin`. */
export interface RunOrigin {
  kind: 'web' | 'mcp' | 'worker';
  /** The action, tool or job that opened it: `episodes.generateStory` */
  name: string;
  /** MCP clientInfo.name, when external */
  clientName?: string;
  /** What the external client reports it writes with (self-reported) */
  model?: string;
}

/** What a run is on: the row it locks and what the stage needs. */
export interface RunTarget {
  type: TargetType;
  id: string;
  accountId: string;
  /** Null for a run on the caller's own text (publish_metadata) */
  projectId: string | null;
  input: RunInput;
  /** `episodes.version` at the brief, for TARGET_CHANGED at finalize */
  targetVersion?: number | null;
  prompt?: { slug: string; version: number };
}

/** The `generation_runs` row, as the handle holds it. */
export interface RunRow {
  id: string;
  accountId: string;
  projectId: string | null;
  targetType: TargetType;
  targetId: string;
  stage: StageKey;
  mode: GenerationMode;
  status: RunStatus;
  leaseExpiresAt: string | null;
  targetVersion: number | null;
  promptSlug: string | null;
  promptVersion: number | null;
  origin: RunOrigin;
  input: RunInput;
  connectionId: string | null;
  parentRunId: string | null;
  error: Record<string, unknown> | null;
  createdBy: string;
  createdAt: string;
  finalizedAt: string | null;
}

/**
 * What a server-mode run reaches when it writes or dispatches: the gateway
 * (`@kit/ai-gateway`) supplies this, so this package never sees a model or
 * the queue. An external run uses neither.
 */
export interface RunBackend {
  write(run: RunHandle, brief: Brief): Promise<GenerateResult>;
  dispatch(run: RunHandle): Promise<void>;
}

/**
 * `Ctx` plus what deciding a run's mode needs. `runMode` is the seam the
 * MCP server wires from its request context (FILM-1908): inside an MCP
 * request it answers 'external', and the mode is never a caller argument.
 * `connectionId` is the MCP connection, which the database CHECK also
 * forces external.
 */
export interface RunCtx extends Ctx {
  runMode?: () => GenerationMode | undefined;
  connectionId?: string;
  clientName?: string;
  backend?: RunBackend;
}

/** A stage the commit of a parent opens as a child run, in the parent's mode. */
export interface FollowOn {
  stage: StageKey;
  target: Omit<RunTarget, 'accountId'>;
  name?: string;
}

/** Stages that render media rather than write content: always server mode. */
export const RENDER_STAGES: ReadonlySet<StageKey> = new Set<StageKey>([
  'audio_render',
]);
