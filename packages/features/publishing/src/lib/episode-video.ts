/**
 * Which of an episode's stored videos a publish sends (KB-123).
 *
 * This was written out three times — the scheduled-publish Lambda, the
 * in-app scheduled job, and publish-now — so a check on the result would have
 * had to be added three times, and a fourth copy would have skipped it. Now
 * there is one place, and the publish-time ownership check (KB-123, waiting
 * on the owner's count) goes here once.
 *
 * The three copies did not agree, and they still do not: each caller passes
 * the precedence it had, so this refactor publishes exactly what it did
 * before. `episode-video.test.ts` pins each caller's behaviour. Making them
 * agree is a product decision, recorded in KB-123's leads.
 *
 * Environment-free and without `server-only`: the Lambda imports it.
 */
import { groupTakesPlatform } from './shorts-targets';

export interface EpisodeVideoSource {
  final_video_url?: string | null;
  localized_videos?: unknown;
  shorts_groups?: unknown;
}

export interface EpisodeVideoRequest {
  language: string;
  /** The channel's platform: a Shorts group goes only to the ones it names */
  platform: string;
  /** A Shorts publish (content type `short`) */
  short: boolean;
  /** The Shorts group the publish names, when the caller uses it */
  shortsGroupId?: string | null;
  /** A short with no group named gets no video (the scheduled Lambda) */
  requireShortsGroup: boolean;
  /** A short with no group video falls back to the full video */
  shortFallsBackToFull: boolean;
  /** A full publish with no full video falls back to a group's short (publish-now) */
  fullFallsBackToShort: boolean;
}

export interface ResolvedEpisodeVideo {
  url: string;
  from: 'short' | 'localized' | 'final';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-empty string, or null: public sharing writes objects into these columns */
function videoAt(record: unknown, key: string): string | null {
  const value = isRecord(record) ? record[key] : undefined;
  return typeof value === 'string' && value !== '' ? value : null;
}

function platformsOf(group: Record<string, unknown>) {
  return Array.isArray(group.platforms)
    ? group.platforms.filter((p): p is string => typeof p === 'string')
    : null;
}

/**
 * The first group (the named one, when a name is given) holding `language`
 * and going to `platform`
 */
function shortsVideo(
  groups: unknown,
  language: string,
  platform: string,
  shortsGroupId: string | null | undefined,
): string | null {
  if (!Array.isArray(groups)) return null;

  for (const group of groups) {
    if (!isRecord(group)) continue;
    if (shortsGroupId && group.id !== shortsGroupId) continue;
    if (!groupTakesPlatform({ platforms: platformsOf(group) }, platform)) {
      continue;
    }

    const url = videoAt(group.videos, language);
    if (url) return url;
  }

  return null;
}

export function resolveEpisodeVideo(
  episode: EpisodeVideoSource,
  request: EpisodeVideoRequest,
): ResolvedEpisodeVideo | null {
  const { language, platform } = request;

  // A short whose group is not for this platform sends nothing: falling back
  // to the full video would put the wrong cut there all the same.
  if (request.short && namedGroupExcludes(episode.shorts_groups, request)) {
    return null;
  }

  const short = () =>
    request.requireShortsGroup && !request.shortsGroupId
      ? null
      : shortsVideo(
          episode.shorts_groups,
          language,
          platform,
          request.shortsGroupId,
        );

  const localized = videoAt(episode.localized_videos, language);
  const final = episode.final_video_url || null;

  type Step = [ResolvedEpisodeVideo['from'], () => string | null];

  const full: Step[] = [
    ['localized', () => localized],
    ['final', () => final],
  ];

  const order: Step[] = request.short
    ? [['short', short], ...(request.shortFallsBackToFull ? full : [])]
    : request.fullFallsBackToShort
      ? [full[0]!, ['short', short], full[1]!]
      : full;

  for (const [from, find] of order) {
    const url = find();
    if (url) return { url, from };
  }

  return null;
}

function namedGroupExcludes(groups: unknown, request: EpisodeVideoRequest) {
  if (!request.shortsGroupId || !Array.isArray(groups)) return false;

  const group = groups.find(
    (candidate) =>
      isRecord(candidate) && candidate.id === request.shortsGroupId,
  );

  return (
    isRecord(group) &&
    !groupTakesPlatform({ platforms: platformsOf(group) }, request.platform)
  );
}

/** The scheduled-publish Lambda: a short needs its group, and nothing falls back */
export const SCHEDULED_LAMBDA_PRECEDENCE = {
  requireShortsGroup: true,
  shortFallsBackToFull: false,
  fullFallsBackToShort: false,
} as const;

/** The in-app scheduled job: a short falls back to the full video */
export const SCHEDULED_JOB_PRECEDENCE = {
  requireShortsGroup: false,
  shortFallsBackToFull: true,
  fullFallsBackToShort: false,
} as const;

/** Publish-now: both fall back to the other; a short uses the group it names (KB-133) */
export const PUBLISH_NOW_PRECEDENCE = {
  requireShortsGroup: false,
  shortFallsBackToFull: true,
  fullFallsBackToShort: true,
} as const;
