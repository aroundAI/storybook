/**
 * The outlines around an episode being regenerated, as prompt context
 * (KB-121). The implementation lives in `@kit/generation` (FILM-1901), where
 * the season_outline stage renders it; this module keeps the import path.
 */
export { formatNeighbouringEpisodes } from '@kit/generation/formatters';
