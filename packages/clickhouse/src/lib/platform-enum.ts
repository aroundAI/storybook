/**
 * The ClickHouse `platform` enum, stated once (FILM-1720).
 *
 * Six analytics tables carry `platform Enum(...)`, and a query that filters
 * on a platform has to declare the same enum for its parameter, or a valid
 * selection errors at the server. Before this, the parameter type was a
 * literal in `queries.ts` that nobody had to touch when a platform was added.
 *
 * The ordinals are the stored values: **append, never renumber**. Renumbering
 * rewrites every row. `platform-enum.test.ts` fails when this disagrees with
 * the latest migration that widens the column.
 */
import type { AnalyticsPlatform } from '../types';

export const PLATFORM_ENUM_VALUES = {
  youtube: 1,
  tiktok: 2,
  instagram: 3,
  facebook: 4,
} as const satisfies Record<AnalyticsPlatform, number>;

/** `Enum('youtube' = 1, …)`, for a column or a query parameter. */
export const PLATFORM_ENUM_TYPE = `Enum(${Object.entries(PLATFORM_ENUM_VALUES)
  .map(([name, value]) => `'${name}' = ${value}`)
  .join(', ')})`;
