/**
 * KB-213. The same video is never posted twice to one account.
 *
 * On 19 Oct 2026 "Publish All" ran twice (KB-204) and posted the same
 * Short to one Facebook Page twice. Nothing below the button asked whether
 * the account already had the video. This is that question, asked in one
 * place by every path that writes or sends a post: the publish worker
 * before it uploads (publish now, retry and the scheduled job all reach the
 * platform through it, KB-206), and the Publish screen, MCP
 * schedule_publish and schedule_release before they write a row.
 *
 * Another post of the same episode, kind (`full` or `short`) and connection
 * is a duplicate when it is `published` in the last 30 days, or
 * `publishing` and started in the last 30 minutes, and it carries the same
 * title or the same file: for a Short its Shorts group in the same
 * language, for a long video the episode's video in the same language. A
 * `deleted` row (marked removed) is not counted, so a video taken down on
 * the platform can be posted again. A YouTube video uploaded ahead of its
 * time (KB-214: `scheduled`, with `metadata.youtube.videoId`) is on the
 * account already, and counts as posted.
 *
 * Pure apart from one read, so the worker lambda and the web actions share
 * it (no `server-only`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

type Client = SupabaseClient<Database>;

const PUBLISHED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const PUBLISHING_WINDOW_MS = 30 * 60 * 1000;

export interface PostCandidate {
  /** The row being sent; absent while it is still being scheduled */
  publishId?: string;
  episodeId: string;
  connectionId: string;
  contentType: string;
  title: string | null;
  language: string | null;
  shortsGroupId: string | null;
  /** When this row's own upload started (the worker's `publishingStartedAt`) */
  startedAt?: string | null;
}

interface OtherPost {
  id: string;
  status: string;
  title: string | null;
  language: string | null;
  platform_url: string | null;
  published_at: string | null;
  created_at: string;
  metadata: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sameTitle(a: string | null, b: string | null) {
  const left = a?.trim().toLowerCase();
  return !!left && left === b?.trim().toLowerCase();
}

function sameFile(candidate: PostCandidate, other: OtherPost) {
  const sameLanguage = (candidate.language ?? '') === (other.language ?? '');

  if (candidate.contentType !== 'short') return sameLanguage;

  const group = record(other.metadata).shortsGroupId;
  return (
    sameLanguage &&
    !!candidate.shortsGroupId &&
    typeof group === 'string' &&
    group === candidate.shortsGroupId
  );
}

/**
 * Whether `other` is a post of this video that went out, or is going out,
 * ahead of the candidate. Two uploads of one video that start together
 * (the same SQS batch) are ordered by start time, then id, so exactly one
 * of them goes.
 */
function stagedVideo(other: { status: string; metadata?: unknown }) {
  const youtube = record(record(other.metadata).youtube);
  return other.status === 'scheduled' && typeof youtube.videoId === 'string'
    ? youtube
    : null;
}

function aheadOf(candidate: PostCandidate, other: OtherPost, now: Date) {
  if (other.status === 'scheduled') return !!stagedVideo(other);

  if (other.status === 'published') {
    const at = Date.parse(other.published_at ?? other.created_at);
    return now.getTime() - at <= PUBLISHED_WINDOW_MS;
  }

  const started = record(other.metadata).publishingStartedAt;
  if (typeof started !== 'string') return false;

  const at = Date.parse(started);
  if (now.getTime() - at > PUBLISHING_WINDOW_MS) return false;
  if (!candidate.startedAt) return true;

  const mine = Date.parse(candidate.startedAt);
  return at < mine || (at === mine && other.id < (candidate.publishId ?? ''));
}

export function duplicateMessage(other: {
  status: string;
  platform_url: string | null;
  published_at: string | null;
  created_at: string;
  metadata?: unknown;
}): string {
  if (other.status === 'published') {
    const date = (other.published_at ?? other.created_at).slice(0, 10);
    const where = other.platform_url ? ` as ${other.platform_url}` : '';

    return `Already posted to this account${where} on ${date}; not posted again. If it was taken down there, mark it as removed on the Schedule tab first.`;
  }

  const staged = stagedVideo(other);
  if (staged) {
    const where = other.platform_url ? ` as ${other.platform_url}` : '';
    const at =
      typeof staged.publishAt === 'string'
        ? `, public at ${staged.publishAt}`
        : '';

    return `Already uploaded to this account${where} (private until its time${at}); not posted again. Cancel that post first to send this one.`;
  }

  const started = record(other.metadata).publishingStartedAt;
  const since = typeof started === 'string' ? ` (started ${started})` : '';

  return `Already being posted to this account${since}; not posted again.`;
}

/** The duplicate this candidate would be, worded for the person; or null */
export async function duplicatePostRefusal(
  client: Client,
  candidate: PostCandidate,
  now = new Date(),
): Promise<string | null> {
  const { data, error } = await client
    .from('publishes')
    .select(
      'id, status, title, language, platform_url, published_at, created_at, metadata',
    )
    .eq('episode_id', candidate.episodeId)
    .eq('platform_connection_id', candidate.connectionId)
    .eq('content_type', candidate.contentType)
    .in('status', ['published', 'publishing', 'scheduled']);

  if (error) {
    throw new Error(
      `Could not check this account's earlier posts: ${error.message}`,
    );
  }

  const duplicate = ((data ?? []) as OtherPost[])
    .filter((other) => other.id !== candidate.publishId)
    .filter(
      (other) =>
        sameTitle(candidate.title, other.title) || sameFile(candidate, other),
    )
    .filter((other) => aheadOf(candidate, other, now))
    // A published post is the better answer: it has a link
    .sort((a, b) =>
      a.status === b.status ? 0 : a.status === 'published' ? -1 : 1,
    )[0];

  return duplicate ? duplicateMessage(duplicate) : null;
}

/** The first duplicate among several candidates, or null */
export async function firstDuplicatePostRefusal(
  client: Client,
  candidates: PostCandidate[],
  now = new Date(),
): Promise<string | null> {
  for (const candidate of candidates) {
    const refusal = await duplicatePostRefusal(client, candidate, now);
    if (refusal) return refusal;
  }

  return null;
}
