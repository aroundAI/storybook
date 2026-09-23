/**
 * The values `platform_connections.platform` may hold - its CHECK constraint
 * (`20251205125737_film-studio-tables.sql`). The column is a varchar, so the
 * generated types say `string`; this list is the one place the set is
 * written, and `platforms.test.ts` fails if it and the constraint differ.
 *
 * Pure, so client code and the worker lambdas can import it.
 */
export const PLATFORMS = [
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
  'twitter',
  'linkedin',
] as const;

export type Platform = (typeof PLATFORMS)[number];

/** Narrows a stored `platform` string, so it is checked rather than cast. */
export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}
