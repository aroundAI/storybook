/**
 * The handle a caller drives a run through (FILM-1903, EDD "2. Generation
 * runs and leases" and "6. One door to AI models"). Business code asks the
 * run for output (`write`) or to be queued (`dispatch`); the run's mode,
 * fixed when `openRun` created it, decides what happens. A server run
 * reaches the gateway's writer; an external run never does. Every call
 * renews the 30-minute lease.
 */
import type { AppliedCommit, CommitApplier, CommitPlan } from '../commit-plan';
import type {
  Brief,
  GenerateResult,
  GenerationRun,
  GenerationUsage,
  RevisionSnapshot,
} from '../types';
import { RunError } from './errors';
import { toRevisionSnapshot } from './revisions';
import {
  applyGenerationCommit,
  readEpisodeVersion,
  recordRevision,
  renewLease,
  transitionRun,
} from './store';
import { OPEN_STATUSES, type RunCtx, type RunRow } from './types';

export class RunHandle {
  constructor(
    private row: RunRow,
    readonly ctx: RunCtx,
  ) {}

  get id() {
    return this.row.id;
  }
  get accountId() {
    return this.row.accountId;
  }
  get projectId() {
    return this.row.projectId;
  }
  get stage() {
    return this.row.stage;
  }
  get mode() {
    return this.row.mode;
  }
  get status() {
    return this.row.status;
  }
  get targetType() {
    return this.row.targetType;
  }
  get targetId() {
    return this.row.targetId;
  }
  get targetVersion() {
    return this.row.targetVersion;
  }
  get input() {
    return this.row.input;
  }
  get origin() {
    return this.row.origin;
  }
  get parentRunId() {
    return this.row.parentRunId;
  }
  get connectionId() {
    return this.row.connectionId;
  }
  get createdBy() {
    return this.row.createdBy;
  }
  get leaseExpiresAt() {
    return this.row.leaseExpiresAt;
  }
  get error() {
    return this.row.error;
  }

  /** The row as last read; `renewLease()` refreshes it. */
  snapshotRow(): RunRow {
    return { ...this.row };
  }

  /** Open: briefed or in progress, with a lease that has not passed. */
  isOpen(now = new Date()): boolean {
    if (!OPEN_STATUSES.has(this.row.status)) return false;

    return (
      this.row.leaseExpiresAt === null ||
      new Date(this.row.leaseExpiresAt).getTime() > now.getTime()
    );
  }

  /**
   * Renews the lease and refreshes the row. A run that is terminal or past
   * its lease is not renewed; the refreshed row says so and `isOpen()` is
   * then false. Throws only when the run no longer exists or the store
   * refuses.
   */
  async renewLease(): Promise<RunRow> {
    const { run } = await renewLease(this.ctx.client, this.row.id);

    this.row = run;

    return run;
  }

  private requireOpen(action: string) {
    if (!this.isOpen()) {
      throw new RunError(
        'RUN_NOT_OPEN',
        `Run ${this.row.id} is ${this.row.status}${this.isLeasePassed() ? ' with its lease expired' : ''}; it cannot ${action}`,
        { runId: this.row.id },
      );
    }
  }

  private isLeasePassed(now = new Date()) {
    return (
      this.row.leaseExpiresAt !== null &&
      new Date(this.row.leaseExpiresAt).getTime() <= now.getTime()
    );
  }

  private requireBackend(action: string) {
    const backend = this.ctx.backend;

    if (!backend) {
      throw new RunError(
        'NO_RUN_BACKEND',
        `Run ${this.row.id} was opened without a backend; it cannot ${action}. Open it through @kit/ai-gateway.`,
        { runId: this.row.id },
      );
    }

    return backend;
  }

  /**
   * One part's output. Server mode: the gateway's server writer, which
   * re-checks this run before its model call. External mode: nothing is
   * written here; the agent submits the part, and the caller gets the
   * brief back as AWAITING_SUBMISSION.
   */
  async write(brief: Brief): Promise<GenerateResult> {
    if (this.row.mode === 'external') {
      throw new RunError(
        'AWAITING_SUBMISSION',
        `Run ${this.row.id} is external: part ${brief.part.key} is written by the agent and submitted, not generated here`,
        { brief, runId: this.row.id },
      );
    }

    const backend = this.requireBackend('write');

    await this.renewLease();
    this.requireOpen('write');

    return backend.write(this, { ...brief, runId: this.row.id });
  }

  /** Queues this run for the worker. Refuses anything but an open server run. */
  async dispatch(): Promise<void> {
    if (this.row.mode !== 'server') {
      throw new RunError(
        'RUN_NOT_SERVER',
        `Run ${this.row.id} is ${this.row.mode}; only a server run is queued for the worker`,
        { runId: this.row.id },
      );
    }

    const backend = this.requireBackend('dispatch');

    await this.renewLease();
    this.requireOpen('dispatch');

    await backend.dispatch(this);
  }

  /** briefed -> in_progress; also renews the lease. */
  async start(): Promise<void> {
    this.row = await transitionRun(this.ctx.client, this.row.id, 'in_progress');
  }

  /** Moves the run to committed; a no-op when its commit already did. */
  async complete(): Promise<void> {
    if (this.row.status === 'committed') return;

    this.row = await transitionRun(this.ctx.client, this.row.id, 'committed');
  }

  /**
   * Applies a stage's commit plan in one transaction (FILM-1903): the run
   * checks, the content_revisions snapshot, every write and, with
   * `finalize`, the move to committed. A job whose handler commits more
   * than once, or works on after its commit, passes `finalize: false` and
   * completes the run itself.
   */
  async applyCommit(
    plan: CommitPlan,
    options: { finalize: boolean },
  ): Promise<AppliedCommit> {
    const { run, applied } = await applyGenerationCommit(
      this.ctx.client,
      this.row.id,
      plan,
      options.finalize,
    );

    this.row = run;

    return applied;
  }

  /** The applier a stage's `Ctx.commits` takes under this run. */
  commitApplier(options: { finalize: boolean }): CommitApplier {
    return (plan) => this.applyCommit(plan, options);
  }

  async fail(error: unknown): Promise<void> {
    this.row = await transitionRun(
      this.ctx.client,
      this.row.id,
      'failed',
      describeError(error),
    );
  }

  async cancel(reason?: string): Promise<void> {
    this.row = await transitionRun(this.ctx.client, this.row.id, 'cancelled', {
      code: 'CANCELLED',
      ...(reason ? { reason } : {}),
    });
  }

  /**
   * TARGET_CHANGED: the episode moved since the brief. Only an episode
   * target has a version; every other target passes.
   */
  async assertTargetUnchanged(): Promise<void> {
    if (this.row.targetType !== 'episode' || this.row.targetVersion === null) {
      return;
    }

    const current = await readEpisodeVersion(
      this.ctx.client,
      this.row.targetId,
    );

    if (current !== null && current !== this.row.targetVersion) {
      throw new RunError(
        'TARGET_CHANGED',
        `Episode ${this.row.targetId} is at version ${current}; run ${this.row.id} was briefed on version ${this.row.targetVersion}`,
        { runId: this.row.id },
      );
    }
  }

  /** What a commit is about to replace, filed under this run. */
  async snapshot(input: RevisionSnapshot): Promise<string> {
    return recordRevision(
      this.ctx.client,
      this.row.id,
      toRevisionSnapshot(input),
    );
  }

  /** The run a stage's `commit` receives, with the origin it stamps. */
  toGenerationRun(usage?: GenerationUsage, now = new Date()): GenerationRun {
    return {
      id: this.row.id,
      mode: this.row.mode,
      origin: {
        kind: this.row.mode,
        runId: this.row.id,
        model: usage?.model ?? this.row.origin.model,
        promptSlug: this.row.promptSlug ?? undefined,
        promptVersion: this.row.promptVersion ?? undefined,
        clientName: this.row.origin.clientName,
        at: now.toISOString(),
      },
      usage,
    };
  }
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof RunError) {
    return { code: error.code, message: error.message };
  }

  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;

    return {
      code: typeof code === 'string' ? code : error.name,
      message: error.message.slice(0, 1000),
    };
  }

  return { code: 'UNKNOWN', message: String(error).slice(0, 1000) };
}
