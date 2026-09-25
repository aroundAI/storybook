/**
 * When a narrative thread was last active, and whether it is stale: the one
 * rule CANON_007 (KB-72) and the canon health dashboard (KB-108) both use.
 *
 * A thread is active in the episode it opened in and every episode that
 * touched it; "last active" is the latest of those by episode number. A
 * thread none of whose episodes resolve to a number is never stale: not
 * knowing is not evidence that it was forgotten.
 *
 * Client-safe: no I/O. Resolving ids to numbers is the caller's read.
 */

export interface ThreadEpisodes {
  /** `narrative_threads.opened_at`, an episode id */
  openedAt: string;
  /** `narrative_threads.episodes_touched`, episode ids */
  episodesTouched?: string[] | null;
}

/** Every episode id a thread was active in, opening included */
export function threadEpisodeIds(thread: ThreadEpisodes): string[] {
  return [thread.openedAt, ...(thread.episodesTouched ?? [])];
}

/** The latest episode number the thread was active in; undefined if none resolve */
export function threadLastActiveEpisode(
  thread: ThreadEpisodes,
  episodeNumbers: ReadonlyMap<string, number>,
): number | undefined {
  const numbers = threadEpisodeIds(thread)
    .map((id) => episodeNumbers.get(id))
    .filter((n): n is number => n !== undefined);

  return numbers.length > 0 ? Math.max(...numbers) : undefined;
}

/**
 * How many episodes ago the thread was last active, when that is
 * `threshold` or more: the thread is stale. Undefined when it is not stale,
 * including when its last active episode is unknown.
 */
export function staleForEpisodes(
  lastActiveEpisodeNumber: number | undefined,
  currentEpisodeNumber: number,
  threshold: number,
): number | undefined {
  if (lastActiveEpisodeNumber === undefined) return undefined;

  const since = currentEpisodeNumber - lastActiveEpisodeNumber;

  return since >= threshold ? since : undefined;
}

export function isThreadStale(
  lastActiveEpisodeNumber: number | undefined,
  currentEpisodeNumber: number,
  threshold: number,
): boolean {
  return (
    staleForEpisodes(
      lastActiveEpisodeNumber,
      currentEpisodeNumber,
      threshold,
    ) !== undefined
  );
}
