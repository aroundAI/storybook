/**
 * A stage's commit as data (FILM-1901 criterion 4, FILM-1903). `commit()`
 * reads what it needs, computes the writes, and hands them to one applier
 * as a `CommitPlan`; under a run the applier is the database function
 * `apply_generation_commit`, which checks the run, snapshots what the plan
 * replaces into content_revisions, applies every write against its
 * allowlist and commits the run, all in one transaction (migration
 * 20261003125108). Nothing here reaches PostgREST but the run-less applier
 * in `commit-through-client.ts`.
 */
import { applyPlanThroughClient } from './commit-through-client';
import type { Ctx } from './types';

/** The tables a commit writes: `kit.generation_commit_allowlist()`. */
export type CommitTable =
  | 'episodes'
  | 'projects'
  | 'assets'
  | 'shots'
  | 'audio_cues'
  | 'audio_tracks'
  | 'dialogue_lines'
  | 'generation_jobs'
  | 'verified_facts'
  | 'immutable_events'
  | 'character_states'
  | 'narrative_threads'
  | 'episode_summaries'
  | 'world_states'
  | 'state_deltas';

/**
 * A value a later write takes from an earlier keyed one: `column` of every
 * row it returned, as an array (`one`: the first value). The earlier write
 * must list `column` in its `returning`.
 */
export interface CommitRef {
  $ref: string;
  column: string;
  one?: boolean;
}

/** The arrays concatenated, each value once, in order. */
export interface CommitUnion {
  $union: unknown[];
}

export type CommitRow = Record<string, unknown>;

/**
 * A filter, as PostgREST's: `column` is a column or `column->>key` (eq and
 * neq only); `is` takes null, true or false.
 */
export type CommitFilter =
  | { column: string; op: 'eq' | 'neq'; value: unknown }
  | { column: string; op: 'in'; value: unknown[] }
  | { column: string; op: 'is'; value: null | boolean };

interface WriteBase {
  table: CommitTable;
  /** Names the write, so `results[key]` and a `$ref` reach its rows */
  key?: string;
  /** The columns `results[key]` carries, one object per row */
  returning?: string[];
  /** Fail the commit (or the step) when the write touched no row (KB-105) */
  requireRows?: boolean;
  /**
   * 'skip': a failure undoes this write alone and is reported; the commit
   * goes on. For what the handlers always treated as non-fatal.
   */
  onError?: 'abort' | 'skip';
  /** Leave the write out unless one of these keyed writes wrote a row */
  onlyIfRows?: string[];
}

/**
 * `asObject`: the PostgREST body is the one row itself rather than a
 * one-row array, as the handler sent it. Only the run-less applier reads it.
 */
export type CommitWrite = WriteBase &
  (
    | { op: 'insert'; rows: object[]; asObject?: boolean }
    | {
        op: 'upsert';
        rows: object[];
        asObject?: boolean;
        /** PostgREST's form: 'project_id,type,name' */
        onConflict: string;
        ignoreDuplicates?: boolean;
      }
    | {
        op: 'update';
        values: CommitRow;
        match: CommitFilter[];
        /** jsonb columns merged at the top level (`col || patch`) */
        merge?: string[];
      }
    | { op: 'delete'; match: CommitFilter[] }
  );

/**
 * Writes that succeed or fail together inside the commit: a failure undoes
 * the group alone and is reported, as the handlers' non-fatal blocks were.
 */
export interface CommitGroup {
  op: 'group';
  key?: string;
  onError: 'skip';
  ops: CommitWrite[];
}

export type CommitStep = CommitWrite | CommitGroup;

export interface CommitPlan {
  ops: CommitStep[];
}

export interface SkippedStep {
  key?: string | null;
  table?: string | null;
  error: string;
}

export interface AppliedCommit {
  /** Each keyed write's `returning` columns, one object per row */
  results: Record<string, CommitRow[]>;
  skipped: SkippedStep[];
  /** The content_revisions row of what the plan replaced, when it replaced any */
  revisionId: string | null;
  /** True when the run moved to committed in the same transaction */
  finalized: boolean;
}

/** What applies a plan: the run's database function, or a test's recorder. */
export type CommitApplier = (plan: CommitPlan) => Promise<AppliedCommit>;

export const eq = (column: string, value: unknown): CommitFilter => ({
  column,
  op: 'eq',
  value,
});

export const inList = (column: string, value: unknown[]): CommitFilter => ({
  column,
  op: 'in',
  value,
});

export const is = (column: string, value: null | boolean): CommitFilter => ({
  column,
  op: 'is',
  value,
});

export const ref = (
  key: string,
  column: string,
  options: { one?: boolean } = {},
): CommitRef => ({ $ref: key, column, ...options });

/** Every write of a plan, groups opened, in order. */
export function planWrites(plan: CommitPlan): CommitWrite[] {
  return plan.ops.flatMap((step) => (step.op === 'group' ? step.ops : [step]));
}

/** The rows a keyed write returned; [] when it wrote none or was skipped. */
export function resultRows(applied: AppliedCommit, key: string): CommitRow[] {
  return applied.results[key] ?? [];
}

/** Whether a keyed step (a write or a group) was skipped. */
export function wasSkipped(applied: AppliedCommit, key: string): boolean {
  return applied.skipped.some((step) => step.key === key);
}

/**
 * Applies a commit's plan: through the run's applier when the stage runs
 * under one (one transaction), else through the caller's client. Without a
 * run there is nothing to check a plan against, so only a plan of a single
 * write (atomic by itself) is applied that way; anything more is refused.
 */
export async function applyCommit(
  ctx: Ctx,
  plan: CommitPlan,
): Promise<AppliedCommit> {
  if (ctx.commits) return ctx.commits(plan);

  const writes = planWrites(plan);

  if (writes.length > 1) {
    throw new Error(
      `A commit of ${writes.length} writes runs under a generation run, which applies it in one transaction; this context has none`,
    );
  }

  return applyPlanThroughClient(ctx.client, plan);
}

/**
 * A write refused by a unique index (Postgres 23505), whether it came back
 * from the run's apply_generation_commit (the PostgREST error is the
 * RunError's cause) or from a write through the client (its message).
 */
export function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e; ) {
    if (typeof e !== 'object') return false;
    const { code, message, details } = e as {
      code?: unknown;
      message?: unknown;
      details?: { cause?: unknown };
    };

    if (code === '23505') return true;
    if (
      typeof message === 'string' &&
      message.includes('duplicate key value violates unique constraint')
    ) {
      return true;
    }

    e = details?.cause ?? (e as { cause?: unknown }).cause;
  }

  return false;
}
