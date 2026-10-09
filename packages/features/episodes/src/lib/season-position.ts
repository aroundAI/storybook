/**
 * An episode's place in its season (FILM-2201). Episode numbers are unique
 * per project (KB-175) and never change when an episode moves; the position
 * within a season is derived from them, here, for the web and MCP alike.
 * Pure: safe on the client and the server.
 */
export interface PositionedEpisode {
  id: string;
  seasonId: string | null;
  number: number;
}

/** Each episode's 1-based position among its season's episodes (Unsorted counts as one group), by number. */
export function seasonPositions(
  episodes: readonly PositionedEpisode[],
): Map<string, number> {
  const bySeason = new Map<string | null, PositionedEpisode[]>();

  for (const episode of episodes) {
    const group = bySeason.get(episode.seasonId) ?? [];
    group.push(episode);
    bySeason.set(episode.seasonId, group);
  }

  const positions = new Map<string, number>();

  for (const group of bySeason.values()) {
    [...group]
      .sort((a, b) => a.number - b.number)
      .forEach((episode, index) => positions.set(episode.id, index + 1));
  }

  return positions;
}

/** "S2 · E3" in a season; "#7" (the production number) when Unsorted. */
export function episodeLabel(input: {
  seasonNumber: number | null;
  position: number | undefined;
  number: number;
}) {
  return input.seasonNumber !== null && input.position !== undefined
    ? `S${input.seasonNumber} · E${input.position}`
    : `#${input.number}`;
}
