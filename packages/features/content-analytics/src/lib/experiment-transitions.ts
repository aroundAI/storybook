/**
 * What an experiment may do next, given its state (FILM-1610 review, B).
 *
 * The before/after comparison is only meaningful if the baseline and the
 * result measured the same thing: the same metric, over the same videos, in
 * windows of the planned length. Each rule here protects one part of that.
 * Pure, so every rule is tested without a database.
 */

/**
 * Fields the baseline is measured over. Changing one after the start would
 * compare a baseline of one thing with a result of another.
 */
const FROZEN_AFTER_START = [
  'metricWatched',
  'reviewWindowDays',
  'publishIds',
] as const;

/** Starting again would overwrite the baseline and the start date. */
export function assertCanStart(status: string): void {
  if (status !== 'planned') {
    throw new Error(
      `Only a planned experiment can be started; this one is ${status}.`,
    );
  }
}

export function assertCanConclude(
  status: string,
  startedAt: string | null,
  endedAt: string,
): void {
  if (status !== 'running') {
    throw new Error(
      `Only a running experiment can be concluded; this one is ${status}.`,
    );
  }

  if (!startedAt) {
    throw new Error('An experiment must be started before it is concluded.');
  }

  // Dates are YYYY-MM-DD, so string order is date order.
  if (endedAt < startedAt) {
    throw new Error(
      `An experiment cannot end (${endedAt}) before it started (${startedAt}).`,
    );
  }
}

/**
 * Abandoning a concluded experiment would overwrite its recorded result with
 * "inconclusive"; an abandoned one has nothing left to abandon.
 */
export function assertCanAbandon(status: string): void {
  if (status !== 'planned' && status !== 'running') {
    throw new Error(
      `Only a planned or running experiment can be abandoned; this one is ${status}.`,
    );
  }
}

/** Refuses an edit to a frozen field once the experiment has started. */
export function assertEditable(status: string, fields: string[]): void {
  if (status === 'planned') return;

  const frozen = fields.filter((field) =>
    (FROZEN_AFTER_START as readonly string[]).includes(field),
  );

  if (frozen.length > 0) {
    throw new Error(
      `${frozen.join(', ')} cannot change once the experiment has started: the baseline was measured over them.`,
    );
  }
}
