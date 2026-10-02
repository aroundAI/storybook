/**
 * The one label map provenance copy reads platform names from (FILM-1705).
 *
 * Every platform a connection can be on, not only the analytics platforms:
 * the coverage strip names a kept LinkedIn channel as retired (FILM-717)
 * rather than dropping it, so it needs LinkedIn's name too.
 */
export const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'X',
  linkedin: 'LinkedIn',
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform.toLowerCase()] ?? platform;
}
