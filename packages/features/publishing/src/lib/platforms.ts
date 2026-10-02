import { X_ENABLED } from './x-switch';

/**
 * The platforms the product supports: every value it may write to
 * `platform_connections.platform`. The column is a varchar with a CHECK, so
 * the generated types say `string`; this list is the one place the set is
 * written, and `platforms.test.ts` holds it to the constraint.
 *
 * The CHECK still admits one value this list does not: a platform removed
 * from the product whose old rows are kept (FILM-717). Such a row is not a
 * `Platform`: `isPlatform` rejects it, so it is never shown, refreshed or
 * published to, and nothing can create one.
 *
 * Pure, so client code and the worker lambdas can import it.
 */
export const PLATFORMS = [
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
  'twitter',
] as const;

export type Platform = (typeof PLATFORMS)[number];

/** How each platform is named to the user. */
export const PLATFORM_NAMES: Record<Platform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
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

/** Narrows a stored `platform` string, so it is checked rather than cast. */
export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

/**
 * A platform the product supports but does not show: X while `X_ENABLED` is
 * off (owner, 2026-10-02). Unlike a removed platform its code stays, so
 * switching it on is all it takes to offer it again.
 */
export function isHiddenPlatform(value: string): boolean {
  return value === 'twitter' && !X_ENABLED;
}

/**
 * A stored `platform` a person may see, connect, publish to and have
 * refreshed. Every surface that lists platforms or acts on a kept row reads
 * this rather than `isPlatform`, so a hidden platform's rows are kept and
 * never touched.
 */
export function isOfferedPlatform(value: string): value is Platform {
  return isPlatform(value) && !isHiddenPlatform(value);
}

/** Every platform offered, in `PLATFORMS` order. */
export const OFFERED_PLATFORMS: readonly Platform[] =
  PLATFORMS.filter(isOfferedPlatform);
