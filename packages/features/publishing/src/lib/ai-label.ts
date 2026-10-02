import { PLATFORMS, PLATFORM_NAMES, type Platform } from './platforms';

/**
 * FILM-1731. The field each platform's publish API takes for a creator's
 * own AI disclosure, or null where the call we make has none. Sources, read
 * 2026-10-02, are in the spec's notes and the capability reference:
 *
 * - Instagram: `is_ai_generated` on POST /{ig-user-id}/media;
 * - YouTube: `status.containsSyntheticMedia` on videos.insert;
 * - TikTok: `post_info.is_aigc` on POST /v2/post/publish/video/init/;
 * - X: `made_with_ai` on POST /2/tweets;
 * - Facebook: none on the Page video or Reels calls;
 * - LinkedIn: none on the Posts or Videos API.
 *
 * Pure, so the publish screen, the providers and the worker lambdas read
 * the same map.
 */
export const AI_LABEL_FIELD: Record<Platform, string | null> = {
  instagram: 'is_ai_generated',
  youtube: 'status.containsSyntheticMedia',
  tiktok: 'post_info.is_aigc',
  twitter: 'made_with_ai',
  facebook: null,
  linkedin: null,
};

/** The platforms whose publish API has no AI-label field. */
export const PLATFORMS_WITHOUT_AI_LABEL = PLATFORMS.filter(
  (platform) => AI_LABEL_FIELD[platform] === null,
);

/**
 * What the publish screen says beside the option, for the connected
 * platforms that cannot carry the label; null when every one can.
 */
export function aiLabelUnsupportedNote(platforms: readonly string[]) {
  const names = PLATFORMS_WITHOUT_AI_LABEL.filter((platform) =>
    platforms.includes(platform),
  ).map((platform) => PLATFORM_NAMES[platform]);

  if (names.length === 0) return null;

  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

  return `${list} can't take the AI label: ${names.length === 1 ? 'its' : 'their'} publishing API has no field for it, so the video goes out there without one.`;
}
