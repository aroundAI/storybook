/**
 * Writes the episode's memory rows (FILM-1004). The implementation lives in
 * `@kit/generation` (FILM-1901): the publish commit and the story stage's
 * commit write them through the same function, so the two cannot drift.
 */
export {
  storeEpisodeMemory,
  type StoredEpisodeMemory,
} from '@kit/generation/canon';
