/**
 * How a run reaches `generation_runs`. Every write goes through a SECURITY
 * DEFINER function (migration 20261002205007): authenticated holds no write
 * privilege on the table, and the MCP path never uses the service role for
 * a user, so the function checks can_write_project of the run's project (or
 * the caller's team membership when it names none; a personal account is
 * refused, KB-99) and the service role passes.
 * Reads use the caller's client under RLS.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { z } from 'zod';

import type { Database, Json } from '@kit/supabase/database';

import type { AppliedCommit, CommitPlan } from '../commit-plan';
import {
  type GenerationMode,
  GenerationModeSchema,
  StageKeySchema,
  TargetTypeSchema,
} from '../types';
import { RunError, type RunHolder } from './errors';
import {
  type RunInput,
  RunInputSchema,
  type RunOrigin,
  type RunRow,
  RunStatusSchema,
} from './types';

const RunRowSchema = z.object({
  id: z.string().uuid(),
  account_id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  target_type: TargetTypeSchema,
  target_id: z.string().uuid(),
  stage: StageKeySchema,
  mode: GenerationModeSchema,
  status: RunStatusSchema,
  lease_expires_at: z.string().nullable(),
  target_version: z.number().int().nullable(),
  prompt_slug: z.string().nullable(),
  prompt_version: z.number().int().nullable(),
  origin: z.record(z.unknown()),
  input: RunInputSchema.or(z.object({}).passthrough()),
  connection_id: z.string().uuid().nullable(),
  parent_run_id: z.string().uuid().nullable(),
  error: z.record(z.unknown()).nullable(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  finalized_at: z.string().nullable(),
});

const HolderSchema = z.object({
  id: z.string().uuid(),
  mode: z.string(),
  status: z.string(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  lease_expires_at: z.string().nullable(),
  origin: z.record(z.unknown()).nullable(),
});

const OpenResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), run: RunRowSchema }),
  z.object({
    ok: z.literal(false),
    code: z.literal('RUN_IN_PROGRESS'),
    holder: HolderSchema,
  }),
]);

const LifecycleResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), run: RunRowSchema }),
  z.object({
    ok: z.literal(false),
    code: z.enum(['RUN_NOT_OPEN', 'RUN_NOT_FOUND']),
    run: RunRowSchema.optional(),
  }),
]);

type Client = SupabaseClient<Database>;

export function toRunRow(row: z.infer<typeof RunRowSchema>): RunRow {
  const input = RunInputSchema.safeParse(row.input);

  return {
    id: row.id,
    accountId: row.account_id,
    projectId: row.project_id,
    targetType: row.target_type,
    targetId: row.target_id,
    stage: row.stage,
    mode: row.mode,
    status: row.status,
    leaseExpiresAt: row.lease_expires_at,
    targetVersion: row.target_version,
    promptSlug: row.prompt_slug,
    promptVersion: row.prompt_version,
    origin: row.origin as unknown as RunOrigin,
    input: input.success
      ? (input.data as RunInput)
      : { kind: 'stage', target: undefined },
    connectionId: row.connection_id,
    parentRunId: row.parent_run_id,
    error: row.error,
    createdBy: row.created_by,
    createdAt: row.created_at,
    finalizedAt: row.finalized_at,
  };
}

function toHolder(holder: z.infer<typeof HolderSchema>): RunHolder {
  return {
    id: holder.id,
    mode: holder.mode,
    status: holder.status,
    createdBy: holder.created_by,
    createdAt: holder.created_at,
    leaseExpiresAt: holder.lease_expires_at,
    origin: holder.origin ?? {},
  };
}

function storeError(what: string, error: { message: string }, runId?: string) {
  return new RunError('RUN_STORE_ERROR', `${what}: ${error.message}`, {
    runId,
  });
}

export interface InsertRunInput {
  accountId: string;
  projectId: string | null;
  targetType: RunRow['targetType'];
  targetId: string;
  stage: RunRow['stage'];
  mode: GenerationMode;
  input: RunInput;
  origin: RunOrigin;
  targetVersion?: number | null;
  prompt?: { slug: string; version: number };
  connectionId?: string;
  parentRunId?: string;
  /** Honoured for the service role only: the user a child run belongs to */
  createdBy?: string;
}

/** `open_generation_run`: the row, or RUN_IN_PROGRESS naming the holder. */
export async function insertRun(
  client: Client,
  input: InsertRunInput,
): Promise<RunRow> {
  const { data, error } = await client.rpc('open_generation_run', {
    p_account_id: input.accountId,
    p_project_id: input.projectId ?? undefined,
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_stage: input.stage,
    p_mode: input.mode,
    p_input: input.input as unknown as Json,
    p_origin: input.origin as unknown as Json,
    p_target_version: input.targetVersion ?? undefined,
    p_prompt_slug: input.prompt?.slug,
    p_prompt_version: input.prompt?.version,
    p_connection_id: input.connectionId,
    p_parent_run_id: input.parentRunId,
    p_created_by: input.createdBy,
  });

  if (error) throw storeError(`opening a ${input.stage} run`, error);

  const result = OpenResultSchema.parse(data);

  if (!result.ok) {
    const holder = toHolder(result.holder);

    throw new RunError(
      'RUN_IN_PROGRESS',
      `A ${input.stage} run on this ${input.targetType} is already open (${holder.mode}, opened ${holder.createdAt} by ${holder.createdBy})`,
      { holder },
    );
  }

  return toRunRow(result.run);
}

export async function selectRun(
  client: Client,
  id: string,
): Promise<RunRow | null> {
  const { data, error } = await client
    .from('generation_runs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw storeError('reading the run', error, id);

  return data ? toRunRow(RunRowSchema.parse(data)) : null;
}

/**
 * `renew_generation_run_lease`: the fresh row. A run that is terminal or
 * past its lease comes back unrenewed, with `open: false`, so the caller
 * (the server writer, before its first model call) decides what to do.
 */
export async function renewLease(
  client: Client,
  id: string,
): Promise<{ open: boolean; run: RunRow }> {
  const { data, error } = await client.rpc('renew_generation_run_lease', {
    p_run_id: id,
  });

  if (error) throw storeError('renewing the lease', error, id);

  const result = LifecycleResultSchema.parse(data);

  if (result.ok) return { open: true, run: toRunRow(result.run) };

  if (!result.run) {
    throw new RunError('RUN_NOT_FOUND', `Run ${id} does not exist`, {
      runId: id,
    });
  }

  return { open: false, run: toRunRow(result.run) };
}

export type RunTransition =
  | 'in_progress'
  | 'committed'
  | 'failed'
  | 'cancelled';

/** `transition_generation_run`: the row after the move, or RUN_NOT_OPEN. */
export async function transitionRun(
  client: Client,
  id: string,
  status: RunTransition,
  errorDetail?: Record<string, unknown>,
): Promise<RunRow> {
  const { data, error } = await client.rpc('transition_generation_run', {
    p_run_id: id,
    p_status: status,
    p_error: errorDetail as Json | undefined,
  });

  if (error) throw storeError(`moving the run to ${status}`, error, id);

  const result = LifecycleResultSchema.parse(data);

  if (result.ok) return toRunRow(result.run);

  if (!result.run) {
    throw new RunError('RUN_NOT_FOUND', `Run ${id} does not exist`, {
      runId: id,
    });
  }

  throw new RunError(
    'RUN_NOT_OPEN',
    `Run ${id} is ${result.run.status}; it cannot move to ${status}`,
    { runId: id },
  );
}

/** `record_content_revision`: the new revision's id. */
export async function recordRevision(
  client: Client,
  runId: string,
  snapshot: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await client.rpc('record_content_revision', {
    p_run_id: runId,
    p_snapshot: snapshot as Json,
  });

  if (error) throw storeError('recording the revision', error, runId);

  return z.string().uuid().parse(data);
}

const CommitResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    run: RunRowSchema,
    results: z.record(z.array(z.record(z.unknown()))),
    skipped: z.array(
      z.object({
        key: z.string().nullable().optional(),
        table: z.string().nullable().optional(),
        error: z.string(),
      }),
    ),
    revision_id: z.string().uuid().nullable(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(['RUN_NOT_FOUND', 'RUN_NOT_OPEN', 'TARGET_CHANGED']),
    run: RunRowSchema.optional(),
    current_version: z.number().int().nullable().optional(),
  }),
]);

/**
 * `apply_generation_commit` (migration 20261003125108): the plan's writes,
 * the content_revisions snapshot and, with `finalize`, the move to
 * committed, in one transaction. A refusal before anything is written
 * comes back as RUN_NOT_OPEN, RUN_NOT_FOUND or TARGET_CHANGED; a write that
 * fails rolls everything back and surfaces as COMMIT_FAILED with the
 * database's message.
 */
export async function applyGenerationCommit(
  client: Client,
  runId: string,
  plan: CommitPlan,
  finalize: boolean,
): Promise<{ run: RunRow; applied: AppliedCommit }> {
  const { data, error } = await client.rpc('apply_generation_commit', {
    p_run_id: runId,
    p_plan: plan as unknown as Json,
    p_finalize: finalize,
  });

  if (error) {
    throw new RunError(
      'COMMIT_FAILED',
      `The commit of run ${runId} was rolled back: ${error.message}`,
      { runId },
    );
  }

  const result = CommitResultSchema.parse(data);

  if (!result.ok) {
    if (result.code === 'TARGET_CHANGED') {
      throw new RunError(
        'TARGET_CHANGED',
        `The episode is at version ${result.current_version ?? 'unknown'}; run ${runId} was briefed on another, so nothing was committed`,
        { runId },
      );
    }

    throw new RunError(
      result.code,
      result.code === 'RUN_NOT_FOUND'
        ? `Run ${runId} does not exist`
        : `Run ${runId} is ${result.run?.status ?? 'closed'}; it cannot commit`,
      { runId },
    );
  }

  const run = toRunRow(result.run);

  return {
    run,
    applied: {
      results: result.results,
      skipped: result.skipped,
      revisionId: result.revision_id,
      finalized: run.status === 'committed',
    },
  };
}

const SettingsSchema = z.object({
  server_generation_enabled: z.boolean(),
  external_generation_enabled: z.boolean(),
  default_mode: GenerationModeSchema,
});

export interface AiSettings {
  serverEnabled: boolean;
  externalEnabled: boolean;
  defaultMode: GenerationMode;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  serverEnabled: true,
  externalEnabled: true,
  defaultMode: 'server',
};

/** `account_ai_settings`, or the defaults for a team with no row. */
export async function readAiSettings(
  client: Client,
  accountId: string,
): Promise<AiSettings> {
  const { data, error } = await client
    .from('account_ai_settings')
    .select(
      'server_generation_enabled, external_generation_enabled, default_mode',
    )
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) throw storeError('reading the AI settings', error);

  if (!data) return DEFAULT_AI_SETTINGS;

  const row = SettingsSchema.parse(data);

  return {
    serverEnabled: row.server_generation_enabled,
    externalEnabled: row.external_generation_enabled,
    defaultMode: row.default_mode,
  };
}

/** `episodes.version` now, for TARGET_CHANGED. */
export async function readEpisodeVersion(
  client: Client,
  episodeId: string,
): Promise<number | null> {
  const { data, error } = await client
    .from('episodes')
    .select('version')
    .eq('id', episodeId)
    .maybeSingle();

  if (error) throw storeError('reading the episode version', error);

  return data?.version ?? null;
}
