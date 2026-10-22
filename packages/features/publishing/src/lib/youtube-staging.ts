import {
  type YouTubeVideoState,
  youtubeProcessingVerdict,
} from './youtube-processing';

/**
 * KB-214. A YouTube video made public the moment its upload finishes is
 * served at 360p until YouTube has made its HD versions, and the viewers
 * who arrive at launch leave. So a scheduled YouTube post (long video or
 * Short) is uploaded ahead of its time, private with `status.publishAt`
 * set to its slot, and YouTube makes it public at that time. Ten minutes
 * before, the scheduled job asks YouTube whether it is ready, and moves
 * `publishAt` on by ten minutes while it is not, every run: it never goes
 * public before HD, however long that takes, and goes within about ten
 * minutes of HD finishing; after six hours held it is flagged, and still
 * held.
 *
 * A breaking release's YouTube post (FILM-2210) has no slot to keep: it
 * uploads at once, private with no `publishAt` (`goLiveWhenReady`), and
 * the scheduled job makes it public the first run after YouTube has HD.
 *
 * "Ready" is `contentDetails.definition === 'hd'` and
 * `processingDetails.processingStatus === 'succeeded'`. YouTube's API says
 * nothing about 4K: a video can be public in HD while its 4K is still
 * being made.
 *
 * Environment-free: the scheduled Lambda, the publish worker and the web
 * app import it.
 */

export const DEFAULT_YOUTUBE_LEAD_MINUTES = 120;
export const MAX_YOUTUBE_LEAD_MINUTES = 1440;

/** A post due sooner than this is uploaded public at its time, as before */
export const PUBLIC_UPLOAD_WITHIN_MS = 2 * 60_000;
/** How long before its time a staged video's readiness is asked */
export const HD_GATE_WINDOW_MS = 10 * 60_000;
/** How far a video that is not ready moves on, each run */
export const HOLD_STEP_MS = 10 * 60_000;
/**
 * A breaking post due this soon is not staged with a time: it uploads when
 * due and goes public when ready
 */
export const BREAKING_WHEN_READY_WITHIN_MS = 10 * 60_000;
/** Held this long in all, a video is flagged; it is still held */
export const HELD_ALERT_MS = 6 * 60 * 60_000;
export const HELD_ALERT = 'held_over_6h';

export const YOUTUBE_GONE_BEFORE_PUBLIC =
  'Deleted on YouTube before going public.';

export const YOUTUBE_4K_LIMIT =
  "YouTube's API reports HD but not 4K, so a video can go public in HD while YouTube is still making its 4K version.";

export type YouTubeHoldReason =
  | 'hd_not_ready'
  | 'processing'
  | 'waiting_for_long_video';

export interface YouTubeDelay {
  at: string;
  from: string;
  to: string;
  reason: YouTubeHoldReason;
}

/** `publishes.metadata.youtube` of a staged upload */
export interface YouTubeStaging {
  videoId: string;
  stagedAt: string;
  /** When YouTube makes it public, as last set there */
  publishAt: string;
  delays: YouTubeDelay[];
  alert?: typeof HELD_ALERT;
  /** A breaking post: made public as soon as YouTube has it in HD */
  goLiveWhenReady?: boolean;
  /** When the scheduled job found it public */
  wentPublicAt?: string;
  /** The episode was deleted (KB-207): the video is deleted on YouTube */
  orphanedAt?: string;
  /** YouTube's last refusal of a change to it */
  error?: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The staged upload a publish's metadata records, or null */
export function youtubeStagingOf(metadata: unknown): YouTubeStaging | null {
  const youtube = record(record(metadata).youtube);

  if (
    typeof youtube.videoId !== 'string' ||
    typeof youtube.publishAt !== 'string'
  ) {
    return null;
  }

  return {
    ...(youtube as Partial<YouTubeStaging>),
    videoId: youtube.videoId,
    stagedAt: typeof youtube.stagedAt === 'string' ? youtube.stagedAt : '',
    publishAt: youtube.publishAt,
    delays: Array.isArray(youtube.delays)
      ? (youtube.delays as YouTubeDelay[])
      : [],
  };
}

/** A project's YouTube lead time (`projects.metadata.youtubeLeadMinutes`) */
export function youtubeLeadMinutesOf(projectMetadata: unknown): number {
  const value = record(projectMetadata).youtubeLeadMinutes;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_YOUTUBE_LEAD_MINUTES;
  }

  return Math.min(Math.max(Math.round(value), 0), MAX_YOUTUBE_LEAD_MINUTES);
}

export interface StagingCandidate {
  platform: string;
  scheduled_at: string | null;
  metadata: Record<string, unknown> | null;
  release_priority?: string | null;
}

/** A due breaking YouTube post uploads private and goes public when ready */
export function goesLiveWhenReady(publish: {
  platform: string;
  release_priority?: string | null;
}): boolean {
  return (
    publish.platform === 'youtube' && publish.release_priority === 'breaking'
  );
}

/**
 * Whether a scheduled post is uploaded now, private until its time: a
 * YouTube post not yet uploaded, due within the project's lead time but
 * not within two minutes. A breaking post due within ten minutes waits to
 * be due, and then goes public as soon as it is ready.
 */
export function shouldStage(
  publish: StagingCandidate,
  now: Date,
  leadMinutes: number,
): boolean {
  if (publish.platform !== 'youtube' || !publish.scheduled_at) return false;
  if (leadMinutes <= 0) return false;
  if (record(publish.metadata).youtube) return false;

  const ahead = new Date(publish.scheduled_at).getTime() - now.getTime();

  if (goesLiveWhenReady(publish) && ahead <= BREAKING_WHEN_READY_WITHIN_MS) {
    return false;
  }

  return ahead > PUBLIC_UPLOAD_WITHIN_MS && ahead <= leadMinutes * 60_000;
}

/** What `videos.list part=status,processingDetails,contentDetails` says */
export interface YouTubeReadiness extends YouTubeVideoState {
  status?: YouTubeVideoState['status'] & {
    privacyStatus?: string | null;
    publishAt?: string | null;
  };
  contentDetails?: { definition?: string | null } | null;
}

export type ReadinessVerdict =
  | { state: 'public' }
  | { state: 'failed'; reason: string; error: string }
  | { state: 'ready' }
  | { state: 'hold'; reason: YouTubeHoldReason };

export function readinessVerdict(video: YouTubeReadiness): ReadinessVerdict {
  if (video.status?.privacyStatus === 'public') return { state: 'public' };

  // KB-205's reading of a rejected or abandoned upload, and its words
  const processing = youtubeProcessingVerdict(video);
  if (processing.state === 'failed') return processing;

  if (video.processingDetails?.processingStatus !== 'succeeded') {
    return { state: 'hold', reason: 'processing' };
  }

  return video.contentDetails?.definition === 'hd'
    ? { state: 'ready' }
    : { state: 'hold', reason: 'hd_not_ready' };
}

/** Ten minutes after the later of its time and now */
export function heldPublishAt(publishAt: string, now: Date): Date {
  const from = Math.max(new Date(publishAt).getTime(), now.getTime());

  return new Date(from + HOLD_STEP_MS);
}

export function totalDelayMs(delays: readonly YouTubeDelay[]): number {
  return delays.reduce(
    (sum, delay) =>
      sum + Math.max(0, Date.parse(delay.to) - Date.parse(delay.from)),
    0,
  );
}

/** The staging after one more hold, flagged once held six hours in all */
export function withHold(
  staging: YouTubeStaging,
  hold: { now: Date; to: Date; reason: YouTubeHoldReason },
): YouTubeStaging {
  const delays = [
    ...staging.delays,
    {
      at: hold.now.toISOString(),
      from: staging.publishAt,
      to: hold.to.toISOString(),
      reason: hold.reason,
    },
  ];
  const { error: _cleared, ...rest } = staging;

  return {
    ...rest,
    publishAt: hold.to.toISOString(),
    delays,
    ...(totalDelayMs(delays) >= HELD_ALERT_MS || staging.alert
      ? { alert: HELD_ALERT }
      : {}),
  };
}

/** What a list, a tool or the digest says of a staged post */
export interface YouTubeStagingView {
  staged: boolean;
  goLiveWhenReady: boolean;
  publishAt: string;
  delays: YouTubeDelay[];
  alert: string | null;
  error: string | null;
}

export function youtubeStagingView(
  metadata: unknown,
): YouTubeStagingView | null {
  const staging = youtubeStagingOf(metadata);

  if (!staging) return null;

  return {
    staged: !staging.wentPublicAt,
    goLiveWhenReady: staging.goLiveWhenReady === true,
    publishAt: staging.publishAt,
    delays: staging.delays,
    alert: staging.alert ?? null,
    error: staging.error ?? null,
  };
}

/** A when-ready post held six hours since its upload is flagged */
export function heldTooLong(staging: YouTubeStaging, now: Date): boolean {
  return (
    !!staging.stagedAt &&
    now.getTime() - Date.parse(staging.stagedAt) >= HELD_ALERT_MS
  );
}
