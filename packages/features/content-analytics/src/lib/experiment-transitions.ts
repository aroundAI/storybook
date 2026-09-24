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

/**
 * The fields the edit form locks for a change in this state. The same list
 * `assertEditable` refuses, so the form never offers what the action (and
 * the table) would turn down.
 */
export function frozenFields(status: string): readonly string[] {
  return status === 'planned' ? [] : FROZEN_AFTER_START;
}

/**
 * Whether each move is open, for the page's buttons. Each is the boolean
 * twin of the assert the action runs, so a button is shown exactly when the
 * action would accept it.
 */
export const canStart = (status: string) => status === 'planned';
export const canConclude = (status: string) => status === 'running';
export const canAbandon = (status: string) =>
  status === 'planned' || status === 'running';
export const canDelete = (status: string) =>
  status === 'planned' || status === 'abandoned';

/** Starting again would overwrite the baseline and the start date. */
export function assertCanStart(status: string): void {
  if (!canStart(status)) {
    throw new ActionRefusal(
      `Only a planned change can be started; this one is ${status}.`,
    );
  }
}

export function assertCanConclude(
  status: string,
  startedAt: string | null,
  endedAt: string,
): void {
  if (!canConclude(status)) {
    throw new ActionRefusal(
      `Only a running change can be concluded; this one is ${status}.`,
    );
  }

  if (!startedAt) {
    throw new ActionRefusal('A change must be started before it is concluded.');
  }

  // Dates are YYYY-MM-DD, so string order is date order.
  if (endedAt < startedAt) {
    throw new ActionRefusal(
      `A change cannot end (${endedAt}) before it started (${startedAt}).`,
    );
  }
}

/**
 * Abandoning a concluded experiment would overwrite its recorded result with
 * "inconclusive"; an abandoned one has nothing left to abandon.
 */
export function assertCanAbandon(status: string): void {
  if (!canAbandon(status)) {
    throw new ActionRefusal(
      `Only a planned or running change can be abandoned; this one is ${status}.`,
    );
  }
}

/**
 * Deleting is for a change logged by mistake (KB-7; the owner decided the
 * scope on 2026-09-24). A running change is abandoned first, which stops it
 * and keeps its record; a concluded change is the record the log exists to
 * keep. The table's delete policy holds the same rule.
 */
export function assertCanDelete(status: string): void {
  if (canDelete(status)) return;

  throw new ActionRefusal(
    status === 'running'
      ? 'Only a planned or abandoned change can be deleted; this one is running. Abandon it first to stop it and keep its record.'
      : `Only a planned or abandoned change can be deleted; this one is ${status}.`,
  );
}

/** Refuses an edit to a frozen field once the change has started. */
export function assertEditable(status: string, fields: string[]): void {
  const locked = frozenFields(status);
  const frozen = fields.filter((field) => locked.includes(field));

  if (frozen.length > 0) {
    throw new ActionRefusal(
      `${frozen.join(', ')} cannot change once the change has started: the baseline was measured over them, and the expectation was recorded before the result.`,
    );
  }
}
