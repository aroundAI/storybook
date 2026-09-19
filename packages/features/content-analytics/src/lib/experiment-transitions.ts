/**
 * What an experiment may do next, given its state (FILM-1610 review, B).
 *
 * The before/after comparison is only meaningful if the baseline and the
 * result measured the same thing: the same metric, over the same videos, in
 * windows of the planned length. Each rule here protects one part of that.
 * Pure, so every rule is tested without a database. Each refusal is an
 * `ActionRefusal`, so its wording reaches the user in a production build.
 */
import { ActionRefusal } from './action-result';

/**
 * Fields fixed once the experiment starts. The first three are what the
 * baseline is measured over: changing one would compare a baseline of one
 * thing with a result of another. The last two are the expectation, which
 * is recorded before the result is known so hindsight cannot rewrite it
 * (round 5, H3). The table holds the same rule.
 */
const FROZEN_AFTER_START = [
  'metricWatched',
  'reviewWindowDays',
  'publishIds',
  'hypothesis',
  'expectedOutcome',
] as const;

/** Starting again would overwrite the baseline and the start date. */
export function assertCanStart(status: string): void {
  if (status !== 'planned') {
    throw new ActionRefusal(
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
    throw new ActionRefusal(
      `Only a running experiment can be concluded; this one is ${status}.`,
    );
  }

  if (!startedAt) {
    throw new ActionRefusal(
      'An experiment must be started before it is concluded.',
    );
  }

  // Dates are YYYY-MM-DD, so string order is date order.
  if (endedAt < startedAt) {
    throw new ActionRefusal(
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
    throw new ActionRefusal(
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
    throw new ActionRefusal(
      `${frozen.join(', ')} cannot change once the experiment has started: the baseline was measured over them, and the expectation was recorded before the result.`,
    );
  }
}
