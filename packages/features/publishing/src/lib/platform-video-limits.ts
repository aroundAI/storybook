import type { VideoFacts } from '@kit/shared/vendors';

/**
 * What Facebook and Instagram take from StoryBook (FILM-2212). Both fetch
 * the video from its URL, so their URL-upload limits apply, and both are
 * lower than StoryBook's own upload limit (`MAX_VIDEO_UPLOAD_BYTES`). Meta
 * writes "1 GB" and "300MB" without saying which; the smaller, decimal
 * reading is used, so nothing Meta would refuse is let through.
 *
 * - Facebook, a Page video by `file_url`: "If you upload a video with a
 *   multi-part HTTP request or by providing a URL to a video, the video
 *   cannot exceed 1 GB in size and 20 minutes in duration"
 *   (https://developers.facebook.com/docs/graph-api/reference/event/videos/).
 * - Instagram Reels: "File size: 300MB maximum", "Duration: 15 mins
 *   maximum, 3 seconds minimum"
 *   (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media).
 *
 * YouTube takes 256 GB (videos.insert), more than StoryBook uploads, so it
 * has no entry. X has its own (`xVideoRefusal`).
 */
export const PLATFORM_VIDEO_LIMITS = {
  facebook: { name: 'Facebook', maxBytes: 1e9, maxSeconds: 20 * 60 },
  instagram: {
    name: 'Instagram',
    maxBytes: 300e6,
    maxSeconds: 15 * 60,
    minSeconds: 3,
  },
} as const;

type LimitedPlatform = keyof typeof PLATFORM_VIDEO_LIMITS;

export function hasVideoLimits(platform: string): platform is LimitedPlatform {
  return platform in PLATFORM_VIDEO_LIMITS;
}

const size = (bytes: number) =>
  bytes >= 1e9
    ? `${Number((bytes / 1e9).toFixed(2))} GB`
    : `${Math.ceil(bytes / 1e6)} MB`;

/**
 * Why the platform would refuse this video, in words for the person
 * publishing it, or null. A fact the file did not give is not checked: the
 * upload then refuses it in the platform's own words, as before.
 */
export function platformVideoRefusal(
  platform: LimitedPlatform,
  facts: Pick<VideoFacts, 'bytes' | 'durationSeconds'>,
): string | null {
  const limits: {
    name: string;
    maxBytes: number;
    maxSeconds: number;
    minSeconds?: number;
  } = PLATFORM_VIDEO_LIMITS[platform];
  const { bytes, durationSeconds } = facts;

  if (bytes !== null && bytes > limits.maxBytes) {
    return `${limits.name} can't take this video: it is ${size(bytes)}, and ${limits.name} takes at most ${size(limits.maxBytes)}. Upload a smaller file for ${limits.name}, or leave ${limits.name} out.`;
  }

  if (durationSeconds !== null && durationSeconds > limits.maxSeconds) {
    return `${limits.name} can't take this video: it is ${Math.ceil(durationSeconds / 60)} minutes long, and ${limits.name} takes at most ${limits.maxSeconds / 60} minutes. Leave ${limits.name} out of this one.`;
  }

  if (
    durationSeconds !== null &&
    limits.minSeconds !== undefined &&
    durationSeconds < limits.minSeconds
  ) {
    return `${limits.name} can't take this video: it is ${durationSeconds.toFixed(1)} seconds long, and ${limits.name} needs at least ${limits.minSeconds} seconds.`;
  }

  return null;
}
