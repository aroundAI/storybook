/**
 * The two language dimensions on `video_dim`, and what "nobody set one"
 * looks like in a store that has no NULL (FILM-1702).
 *
 * Pure and dependency-free, so the browser bundle shares the vocabulary
 * with the server instead of restating it.
 *
 * - `content` is `video_dim.language`, from `publishes.language`: the
 *   language of the asset that was published.
 * - `channel` is `video_dim.channel_language`, from
 *   `platform_connections.language`: the language the channel was set up to
 *   serve. It is a routing setting, so it answers a budget question ("should
 *   we keep the Spanish channel?"), not a question about the video.
 *
 * They agree only when routing worked, which is why neither replaces the
 * other.
 */
export const LANGUAGE_DIMENSIONS = ['content', 'channel'] as const;

export type LanguageDimension = (typeof LANGUAGE_DIMENSIONS)[number];

/**
 * What both dim columns hold when no language was ever set.
 *
 * ClickHouse's `LowCardinality(String)` is not nullable, so the absence
 * needs a value. The empty string, because it is also what ClickHouse fills
 * in for a column an insert does not name — so a row written before
 * `channel_language` existed, or by a writer that was never updated, reads
 * as "not set" rather than as a language. A sentinel like `'unknown'` would
 * have to be written deliberately by every writer to mean the same thing.
 *
 * Never a real code. `'en'` played this role until FILM-1702, which made
 * English the bucket for everything nobody had labelled.
 */
export const LANGUAGE_NOT_SET = '';

/**
 * A Postgres language (nullable) as the dim column stores it.
 *
 * Blank and whitespace-only count as not set: `publishes.language` rejects
 * them, but `platform_connections.language` has no such check.
 */
export function toDimLanguage(value: string | null | undefined): string {
  const trimmed = value?.trim();

  return trimmed ? trimmed : LANGUAGE_NOT_SET;
}

/**
 * A dim column value as the application reads it: `null` when no language
 * was set.
 *
 * `null` rather than the sentinel so that the type makes every consumer
 * decide what to do with it. A `string` that might be empty renders as a
 * blank label, or falls through `labels[code] || code` as nothing at all.
 */
export function fromDimLanguage(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}
