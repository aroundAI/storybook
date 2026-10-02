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

/** How each platform is named to the user. */
export const PLATFORM_NAMES: Record<Platform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  twitter: 'X',
};

/**
 * Where unpublishing also deletes the video on the platform: the platforms
 * the publish worker has a delete handler for (`deleteFrom<Platform>` in
 * `apps/web/lambda/publish-worker/handlers/`). Elsewhere only our record is
 * removed. `unpublish-platforms.test.ts` fails if the two differ.
 */
export const PLATFORMS_DELETED_ON_UNPUBLISH = [
  'youtube',
  'facebook',
  'twitter',
] as const satisfies readonly Platform[];

/**
 * Platforms the product no longer offers (FILM-717). LinkedIn was retired
 * "for now" (owner, 2026-10-02) rather than moving its pinned API version
 * past sunset (KB-164). It stays in `PLATFORMS` because stored connections
 * and publishes keep the value: they are shown as retired and read-only,
 * never connected, refreshed or published to.
 */
export const RETIRED_PLATFORMS = [
  'linkedin',
] as const satisfies readonly Platform[];

export type RetiredPlatform = (typeof RETIRED_PLATFORMS)[number];

export type OfferedPlatform = Exclude<Platform, RetiredPlatform>;

export function isRetiredPlatform(value: string): value is RetiredPlatform {
  return (RETIRED_PLATFORMS as readonly string[]).includes(value);
}

/** Every platform a connection can still be made to and published to. */
export const OFFERED_PLATFORMS = PLATFORMS.filter(
  (platform): platform is OfferedPlatform => !isRetiredPlatform(platform),
);

/** Narrows a stored `platform` string, so it is checked rather than cast. */
export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}
