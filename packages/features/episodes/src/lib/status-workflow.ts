import type { EpisodeStatus } from './types';

/**
 * Episode status workflow transitions
 * Defines which status can transition to which other statuses
 *
 * Workflow:
 * draft → story
 * story → draft | storyboard
 * storyboard → story | generating
 * generating → storyboard | editing
 * editing → generating | ready
 * ready → editing | published
 * published → ready
 */
export const EPISODE_STATUS_TRANSITIONS: Record<
  EpisodeStatus,
  EpisodeStatus[]
> = {
  draft: ['story'],
  story: ['draft', 'storyboard'],
  storyboard: ['story', 'generating'],
  generating: ['storyboard', 'editing'],
  editing: ['generating', 'ready'],
  ready: ['editing', 'published'],
  published: ['ready'],
};

/**
 * Validates if a status transition is allowed
 * @param currentStatus - The current status of the episode
 * @param newStatus - The target status to transition to
 * @returns true if the transition is valid
 */
export function isValidStatusTransition(
  currentStatus: EpisodeStatus,
  newStatus: EpisodeStatus,
): boolean {
  const allowedTransitions = EPISODE_STATUS_TRANSITIONS[currentStatus];
  return allowedTransitions?.includes(newStatus) ?? false;
}

/**
 * Gets the next valid statuses for a given current status
 * @param currentStatus - The current status of the episode
 * @returns Array of valid next statuses
 */
export function getNextValidStatuses(
  currentStatus: EpisodeStatus,
): EpisodeStatus[] {
  return EPISODE_STATUS_TRANSITIONS[currentStatus] ?? [];
}

/**
 * Error thrown when an invalid status transition is attempted
 */
export class InvalidStatusTransitionError extends Error {
  constructor(
    public readonly currentStatus: EpisodeStatus,
    public readonly attemptedStatus: EpisodeStatus,
  ) {
    const validTransitions =
      EPISODE_STATUS_TRANSITIONS[currentStatus]?.join(', ') || 'none';
    super(
      `Invalid status transition from '${currentStatus}' to '${attemptedStatus}'. ` +
        `Valid transitions: ${validTransitions}`,
    );
    this.name = 'InvalidStatusTransitionError';
  }
}

/**
 * Error thrown when optimistic locking fails due to version mismatch
 */
export class OptimisticLockError extends Error {
  constructor(entityType: string = 'episode') {
    super(
      `The ${entityType} was modified by another user. Please refresh and try again.`,
    );
    this.name = 'OptimisticLockError';
  }
}
