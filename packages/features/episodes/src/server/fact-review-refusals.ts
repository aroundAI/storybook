/**
 * What a user reads when a fact review or delete is refused (KB-18).
 *
 * `public.set_fact_verification` raises each refusal with its own SQLSTATE,
 * and this is the one place those codes become sentences. A code not listed
 * here is not a refusal but a failure, and stays thrown.
 */

export type FactAction = 'verify' | 'dispute' | 'delete';

export const FACT_REFUSALS = {
  reviewForbidden:
    "Only the project's owner or admins can verify or dispute facts.",
  deleteForbidden: "Only the project's owner or admins can delete facts.",
  notFound: 'This fact no longer exists. Reload the page.',
  reasonRequired: 'A reason is required to dispute a fact.',
  alreadyReviewed: (status: string) =>
    `This fact is already ${status}. Reload the page to see its current state.`,
} as const;

interface DatabaseError {
  code?: string | null;
  details?: string | null;
}

const REVIEWED_STATUSES = new Set(['verified', 'disputed', 'retracted']);

export function factRefusal(
  error: DatabaseError,
  action: FactAction,
): string | null {
  switch (error.code) {
    case '42501':
      return action === 'delete'
        ? FACT_REFUSALS.deleteForbidden
        : FACT_REFUSALS.reviewForbidden;

    case 'P0002':
      return FACT_REFUSALS.notFound;

    case '55000': {
      const status = error.details ?? '';

      return REVIEWED_STATUSES.has(status)
        ? FACT_REFUSALS.alreadyReviewed(status)
        : null;
    }

    case '22023':
      return action === 'dispute' ? FACT_REFUSALS.reasonRequired : null;

    default:
      return null;
  }
}
