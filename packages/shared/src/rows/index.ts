/**
 * KB-138's rule, in one place. `.single()` reports "no row" as PostgREST's
 * `PGRST116`; any other error is a failed read — a statement timeout, a
 * dropped connection — and saying "not found" for it sends whoever reads the
 * log after a missing row that is not missing (KB-137 hid behind exactly
 * that message).
 */
const NO_ROW = 'PGRST116';

interface ReadError {
  code?: string;
  message: string;
}

/** True when a read failed, as opposed to finding no row. */
export function readFailed(error: ReadError | null | undefined): boolean {
  return !!error && error.code !== NO_ROW;
}

/**
 * The message for `if (error || !row)`: `notFound` when there is no row,
 * and when the read failed, `notFound` with the read's own error after it.
 *
 *   if (error || !episode) {
 *     throw new Error(whyNoRow(error, 'Episode not found'));
 *   }
 *
 * Server actions that refuse use `requireRow` (`@kit/next/refusals`), which
 * applies the same rule.
 */
export function whyNoRow(
  error: ReadError | null | undefined,
  notFound: string,
): string {
  return readFailed(error)
    ? `${notFound}: the read failed (${error!.message})`
    : notFound;
}
