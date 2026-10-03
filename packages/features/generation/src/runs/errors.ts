import type { Brief } from '../types';

export type RunErrorCode =
  /** A second open run on the same target and stage; `holder` names the first */
  | 'RUN_IN_PROGRESS'
  /** The run is terminal, or its lease has passed */
  | 'RUN_NOT_OPEN'
  | 'RUN_NOT_FOUND'
  /** dispatch() on a run that is not server mode */
  | 'RUN_NOT_SERVER'
  /** write() on an external run: the agent submits the part instead */
  | 'AWAITING_SUBMISSION'
  /** The target moved since the brief (episodes.version) */
  | 'TARGET_CHANGED'
  /** write() or dispatch() on a run opened without a backend */
  | 'NO_RUN_BACKEND'
  | 'SERVER_GENERATION_DISABLED'
  | 'EXTERNAL_GENERATION_DISABLED'
  /** The database refused the write (RLS, a CHECK, a missing grant) */
  | 'RUN_STORE_ERROR'
  /** A commit's transaction failed and was rolled back: nothing was written */
  | 'COMMIT_FAILED';

export interface RunHolder {
  id: string;
  mode: string;
  status: string;
  createdBy: string;
  createdAt: string;
  leaseExpiresAt: string | null;
  origin: Record<string, unknown>;
}

/**
 * A refusal from the run layer. `code` is what callers branch on and what
 * a server action returns as a value (production redacts thrown text).
 */
export class RunError extends Error {
  override readonly name = 'RunError';

  constructor(
    readonly code: RunErrorCode,
    message: string,
    readonly details: {
      holder?: RunHolder;
      brief?: Brief;
      runId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message);
  }
}

export function isRunError(error: unknown, code?: RunErrorCode) {
  return (
    error instanceof RunError && (code === undefined || error.code === code)
  );
}
