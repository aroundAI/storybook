/**
 * `openRun` is the only constructor of a run (FILM-1903). The mode comes
 * from the caller's context, never from an argument: an MCP request (the
 * `runMode` seam, or a connection id) is external; a web server action gets
 * the team's default from account_ai_settings; a render stage is always
 * server work; a child run inherits its parent's mode.
 */
import { performanceContextForRun } from '../performance-context';
import type { GenerationMode, StageKey } from '../types';
import { RunError } from './errors';
import { RunHandle } from './run-handle';
import { type AiSettings, insertRun, readAiSettings, selectRun } from './store';
import {
  RENDER_STAGES,
  type RunCtx,
  type RunInput,
  type RunOrigin,
  type RunTarget,
} from './types';

function applySettings(
  requested: GenerationMode | undefined,
  settings: AiSettings,
): GenerationMode {
  const mode = requested ?? settings.defaultMode;
  const enabled = {
    server: settings.serverEnabled,
    external: settings.externalEnabled,
  };

  if (enabled[mode]) return mode;

  // The caller named a mode and the team turned it off: refuse
  if (requested) {
    throw new RunError(
      mode === 'server'
        ? 'SERVER_GENERATION_DISABLED'
        : 'EXTERNAL_GENERATION_DISABLED',
      `This team has ${mode} generation turned off`,
    );
  }

  // The team's default is off but the other mode is on: use it
  const other: GenerationMode = mode === 'server' ? 'external' : 'server';

  if (enabled[other]) return other;

  throw new RunError(
    'SERVER_GENERATION_DISABLED',
    'This team has both server and external generation turned off',
  );
}

/**
 * The mode for a new run. Exported for the tests; callers go through
 * `openRun`.
 */
export async function resolveRunMode(
  stage: StageKey,
  accountId: string,
  ctx: RunCtx,
): Promise<GenerationMode> {
  if (RENDER_STAGES.has(stage)) return 'server';

  const requested = ctx.connectionId ? 'external' : ctx.runMode?.();
  const settings = await readAiSettings(ctx.client, accountId);

  return applySettings(requested, settings);
}

/**
 * The run's input with FILM-1912's block, built here once for the run when
 * the opener passed a reader and the opener did not build it already (MCP
 * `start_generation` builds it before its first brief). Opened with the
 * caller's client, so the analytics are read under its scope.
 */
async function withPerformanceContext(
  stage: StageKey,
  target: RunTarget,
  ctx: RunCtx,
): Promise<RunInput> {
  if (target.input.performanceContext) return target.input;

  const performanceContext = await performanceContextForRun(
    ctx,
    ctx.performance,
    { stage, projectId: target.projectId },
  );

  return performanceContext
    ? { ...target.input, performanceContext }
    : target.input;
}

export async function openRun(
  stage: StageKey,
  target: RunTarget,
  origin: RunOrigin,
  ctx: RunCtx,
): Promise<RunHandle> {
  const mode = await resolveRunMode(stage, target.accountId, ctx);
  const input = await withPerformanceContext(stage, target, ctx);

  const row = await insertRun(ctx.client, {
    accountId: target.accountId,
    projectId: target.projectId,
    targetType: target.type,
    targetId: target.id,
    stage,
    mode,
    input,
    origin: {
      ...origin,
      ...(ctx.clientName && !origin.clientName
        ? { clientName: ctx.clientName }
        : {}),
    },
    targetVersion: target.targetVersion,
    prompt: target.prompt,
    connectionId: ctx.connectionId,
  });

  return new RunHandle(row, ctx);
}

/**
 * A run a parent's commit opens (shots -> audio_cues): the parent's mode,
 * account and user, with `parent_run_id` set. Called by the core for a
 * commit's follow-ons, and by a worker handler that chains work itself.
 */
export async function openChildRun(
  parent: RunHandle,
  stage: StageKey,
  target: Omit<RunTarget, 'accountId'>,
  origin: RunOrigin,
  ctx: RunCtx,
): Promise<RunHandle> {
  const row = await insertRun(ctx.client, {
    accountId: parent.accountId,
    projectId: target.projectId,
    targetType: target.type,
    targetId: target.id,
    stage,
    mode: RENDER_STAGES.has(stage) ? 'server' : parent.mode,
    input: target.input,
    origin: {
      ...origin,
      clientName: origin.clientName ?? parent.origin.clientName,
    },
    targetVersion: target.targetVersion,
    prompt: target.prompt,
    connectionId: parent.connectionId ?? undefined,
    parentRunId: parent.id,
    createdBy: parent.createdBy,
  });

  return new RunHandle(row, ctx);
}

/** An existing run by id, for the worker; null when there is none. */
export async function loadRun(
  id: string,
  ctx: RunCtx,
): Promise<RunHandle | null> {
  const row = await selectRun(ctx.client, id);

  return row ? new RunHandle(row, ctx) : null;
}
