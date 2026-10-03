import type { RevisionSnapshot } from '../types';

/**
 * The `content_revisions.snapshot` restore_content_revision reads (FILM-1903
 * part A), from what a commit says it is about to replace: an episode
 * column becomes `{"episode": {column: before}}`, an asset column
 * `{"asset": {column: before}}`, and a row table (`shots`, `dialogue_lines`,
 * `audio_cues`) the rows themselves under its own key.
 */
export function toRevisionSnapshot(
  input: RevisionSnapshot,
): Record<string, unknown> {
  switch (input.table) {
    case 'episodes':
      return { episode: { [input.column]: input.before } };
    case 'assets':
      return { asset: { [input.column]: input.before } };
    default:
      return { [input.table]: input.before };
  }
}
