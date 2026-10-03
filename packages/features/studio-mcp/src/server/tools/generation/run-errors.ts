import 'server-only';

import { StageOutputRejected } from '@kit/generation';

import { McpToolError } from '../../../errors';

/**
 * FILM-1903's RunError, by shape: `name`, `code` and `details`. Matched
 * structurally so this module does not depend on the class identity a
 * second copy of the package would break.
 */
interface RunErrorLike {
  name: 'RunError';
  code: string;
  message: string;
  details?: {
    holder?: {
      id: string;
      mode: string;
      status: string;
      createdBy: string;
      createdAt: string;
      leaseExpiresAt: string | null;
      origin: Record<string, unknown>;
    };
    runId?: string;
  };
}

function isRunErrorLike(error: unknown): error is RunErrorLike {
  return (
    error instanceof Error &&
    error.name === 'RunError' &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

/** The run that holds a target, as an agent can act on it. */
export function describeHolder(
  holder: NonNullable<NonNullable<RunErrorLike['details']>['holder']>,
  holderName: string | null,
) {
  const origin = holder.origin ?? {};

  return {
    runId: holder.id,
    mode: holder.mode,
    status: holder.status,
    userId: holder.createdBy,
    userName: holderName,
    clientName:
      typeof origin.clientName === 'string' ? origin.clientName : null,
    openedFrom: typeof origin.kind === 'string' ? origin.kind : null,
    createdAt: holder.createdAt,
    leaseExpiresAt: holder.leaseExpiresAt,
  };
}

export function holderOf(error: unknown) {
  return isRunErrorLike(error) && error.code === 'RUN_IN_PROGRESS'
    ? (error.details?.holder ?? null)
    : null;
}

/**
 * A run-layer refusal in the tools' error contract (EDD "Error contract").
 * Anything else is rethrown untouched, and the registry turns it into
 * INTERNAL without its message.
 */
export function toRunToolError(
  error: unknown,
  holderName: string | null = null,
): unknown {
  if (error instanceof StageOutputRejected) {
    return new McpToolError(
      'VALIDATION_FAILED',
      `Part ${error.partKey} was refused at finalize; resubmit it.`,
      { details: { partKey: error.partKey, errors: error.errors } },
    );
  }

  if (!isRunErrorLike(error)) return error;

  const runId = error.details?.runId;

  switch (error.code) {
    case 'RUN_IN_PROGRESS': {
      const holder = error.details?.holder;

      return new McpToolError(
        'RUN_IN_PROGRESS',
        holder
          ? `A ${holder.mode} run (${holder.id}) already holds this target and stage, opened ${holder.createdAt}${holderName ? ` by ${holderName}` : ''}; it expires ${holder.leaseExpiresAt ?? 'never'}. Wait for it, or cancel it if it is yours.`
          : error.message,
        holder
          ? { details: { holder: describeHolder(holder, holderName) } }
          : {},
      );
    }
    // The contract's one code for a run that can no longer be driven,
    // whether its lease passed or it was committed, failed or cancelled
    // (mcp_tool_calls.error_code is CHECKed against the list, FILM-1904)
    case 'RUN_NOT_OPEN':
      return new McpToolError(
        'RUN_EXPIRED',
        `${error.message}. Start a new run with start_generation.`,
        { details: { runId } },
      );
    case 'RUN_NOT_FOUND':
      return new McpToolError('NOT_FOUND', 'No such run in your team.', {
        details: { runId },
      });
    case 'TARGET_CHANGED':
      return new McpToolError(
        'TARGET_CHANGED',
        `${error.message}. Nothing was committed and the run is closed; read the episode again and start a new run.`,
        { details: { runId } },
      );
    case 'EXTERNAL_GENERATION_DISABLED':
    case 'SERVER_GENERATION_DISABLED':
      return new McpToolError('FORBIDDEN', error.message, {
        details: { reason: error.code },
      });
    case 'RUN_STORE_ERROR':
      return /refused|permission|privilege/i.test(error.message)
        ? new McpToolError(
            'FORBIDDEN',
            'You do not have write access to this target.',
          )
        : error;
    default:
      return error;
  }
}
