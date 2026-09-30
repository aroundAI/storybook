/**
 * Canon errors (FILM-1005).
 *
 * Each is an `ActionRefusal`, so `returnRefusals` hands its message to the
 * client as a value. A production build replaces the message of an error
 * thrown from a server action with a generic sentence; a refusal the user
 * should read as written must not be thrown as a plain `Error`.
 */
import { ActionRefusal } from '@kit/next/action-result';

export type CanonErrorCode =
  | 'CANON_NOT_FOUND'
  | 'CANON_CONFLICT'
  | 'CANON_VALIDATION'
  | 'CANON_FORBIDDEN';

export class CanonError extends ActionRefusal {
  override name = 'CanonError';

  constructor(
    message: string,
    readonly code: CanonErrorCode,
  ) {
    super(message);
  }
}

export class CanonNotFoundError extends CanonError {
  override name = 'CanonNotFoundError';

  constructor(message: string) {
    super(message, 'CANON_NOT_FOUND');
  }
}

export class CanonConflictError extends CanonError {
  override name = 'CanonConflictError';

  constructor(message: string) {
    super(message, 'CANON_CONFLICT');
  }
}

export class CanonValidationError extends CanonError {
  override name = 'CanonValidationError';

  constructor(message: string) {
    super(message, 'CANON_VALIDATION');
  }
}

export class CanonPermissionError extends CanonError {
  override name = 'CanonPermissionError';

  constructor(message: string) {
    super(message, 'CANON_FORBIDDEN');
  }
}
