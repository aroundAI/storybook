/**
 * KB-205. YouTube takes videos longer than 15 minutes only from a verified
 * channel; an unverified one gets "Processing abandoned — Video is too
 * long". The channel says which it is in `channels.list part=status` →
 * `status.longUploadsStatus`
 * (https://developers.google.com/youtube/v3/docs/channels#status.longUploadsStatus),
 * stored on the connection's metadata at connect and on refresh.
 */

export const YOUTUBE_LONG_UPLOADS_STATUSES = [
  'allowed',
  'eligible',
  'disallowed',
  'longUploadsUnspecified',
] as const;

export type YouTubeLongUploadsStatus =
  (typeof YOUTUBE_LONG_UPLOADS_STATUSES)[number];

/** The longest video an unverified channel may upload */
export const YOUTUBE_UNVERIFIED_MAX_SECONDS = 15 * 60;

export const YOUTUBE_VERIFY_URL = 'https://www.youtube.com/verify';

/** Where the status lives on `platform_connections.metadata` */
export const LONG_UPLOADS_STATUS_KEY = 'long_uploads_status';
export const LONG_UPLOADS_CHECKED_AT_KEY = 'long_uploads_checked_at';

export function parseLongUploadsStatus(
  raw: unknown,
): YouTubeLongUploadsStatus | null {
  return YOUTUBE_LONG_UPLOADS_STATUSES.find((status) => status === raw) ?? null;
}

/** The stored status, or null when it was never read (an older connection) */
export function longUploadsStatusOf(
  metadata: unknown,
): YouTubeLongUploadsStatus | null {
  if (!metadata || typeof metadata !== 'object') return null;

  return parseLongUploadsStatus(
    (metadata as Record<string, unknown>)[LONG_UPLOADS_STATUS_KEY],
  );
}

/** The metadata fields that record a status read now */
export function longUploadsMetadata(
  status: YouTubeLongUploadsStatus | null,
  at: Date = new Date(),
) {
  return {
    [LONG_UPLOADS_STATUS_KEY]: status,
    [LONG_UPLOADS_CHECKED_AT_KEY]: at.toISOString(),
  };
}

const clock = (seconds: number) => {
  const whole = Math.ceil(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/**
 * Why YouTube would abandon this upload for its length, in words for the
 * person publishing it, or null. A length the file did not give is left to
 * the upload, as for the other platforms' limits.
 */
export function youtubeLengthRefusal(
  channelName: string,
  status: YouTubeLongUploadsStatus | null,
  durationSeconds: number | null,
): string | null {
  if (
    durationSeconds === null ||
    durationSeconds <= YOUTUBE_UNVERIFIED_MAX_SECONDS ||
    status === 'allowed'
  ) {
    return null;
  }

  const length = clock(durationSeconds);

  if (status === null) {
    return `YouTube may refuse this video: it is ${length} long, and StoryBook doesn't know yet whether “${channelName}” can upload videos longer than 15 minutes. Press Refresh on the channel in Settings → Platforms to check, or leave YouTube out.`;
  }

  return `YouTube can't take this video on “${channelName}”: it is ${length} long, and an unverified channel can upload at most 15 minutes. Verify the channel at ${YOUTUBE_VERIFY_URL}, then press Refresh on it in Settings → Platforms.`;
}
