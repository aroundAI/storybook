/**
 * KB-214. What the scheduled job does, through the publish worker, with one
 * YouTube channel's staged uploads (see youtube-staging.ts), every five
 * minutes:
 *
 * 1. A staged video whose post was cancelled with its episode (KB-207 marks
 *    it `deleting`), or whose episode was deleted while it uploaded, is
 *    deleted on YouTube and its row removed.
 * 2. One `videos.list` reads the rest. A video YouTube made public marks
 *    its post published at its publish time; one YouTube rejected or
 *    abandoned fails it with YouTube's reason (KB-205's words); one deleted
 *    on YouTube fails it.
 * 3. A post whose time was moved here (the cadence moved it, a breaking
 *    release pushed it back) has its publish time moved on YouTube.
 * 4. The HD gate: ten minutes before its time, a video that is not
 *    processed in HD (or a Short whose long video is not public yet) moves
 *    on ten minutes, on YouTube and in `scheduled_at`, so the Schedule tab,
 *    the cadence and the Shorts queue see the time it will really go. A
 *    breaking post (`goLiveWhenReady`) is made public the first run it is
 *    ready, and flagged once six hours have passed without.
 *
 * Every YouTube refusal is returned, and kept on the row, never dropped.
 * Environment-free: the publish worker imports it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllRows } from '@kit/shared/pagination';
import type { Database, Json } from '@kit/supabase/database';

import { LONG_VIDEO_NEVER_WENT_OUT } from './cadence/dispatch';
import { longVideoStates } from './cadence/gate';
import { YOUTUBE_PROCESSING_KEY } from './youtube-processing';
import {
  HD_GATE_WINDOW_MS,
  HELD_ALERT,
  YOUTUBE_GONE_BEFORE_PUBLIC,
  type YouTubeHoldReason,
  type YouTubeReadiness,
  type YouTubeStaging,
  heldPublishAt,
  heldTooLong,
  readinessVerdict,
  withHold,
  youtubeStagingOf,
} from './youtube-staging';
import type { PublishAtResult } from './youtube-video-api';

type Client = SupabaseClient<Database>;

export interface YouTubeStagingApi {
  readiness(videoIds: string[]): Promise<Map<string, YouTubeReadiness>>;
  updatePublishAt(videoId: string, publishAt: string): Promise<PublishAtResult>;
  makePublic(videoId: string): Promise<PublishAtResult>;
  deleteVideo(videoId: string): Promise<'deleted' | 'gone'>;
}

export interface StagedCheckResult {
  checked: number;
  published: number;
  /** Breaking posts this run made public */
  madePublic: number;
  failed: number;
  held: number;
  moved: number;
  deleted: number;
  /** YouTube's refusals, worded for a log line */
  errors: string[];
}

interface StagedRow {
  id: string;
  episode_id: string;
  platform_connection_id: string | null;
  status: string;
  content_type: string | null;
  after_episode_full: boolean;
  scheduled_at: string | null;
  slot_at: string | null;
  metadata: Record<string, unknown> | null;
  episodes: { deleted_at: string | null } | null;
}

/** Times within a second of each other are the same time */
function sameTime(a: string | null, b: string) {
  return !!a && Math.abs(Date.parse(a) - Date.parse(b)) < 1000;
}

export async function checkStagedYouTube(
  client: Client,
  connectionId: string,
  api: YouTubeStagingApi,
  now: Date = new Date(),
): Promise<StagedCheckResult> {
  const result: StagedCheckResult = {
    checked: 0,
    published: 0,
    madePublic: 0,
    failed: 0,
    held: 0,
    moved: 0,
    deleted: 0,
    errors: [],
  };

  const rows = (
    await fetchAllRows<StagedRow>(
      (from, to) =>
        client
          .from('publishes')
          .select(
            'id, episode_id, platform_connection_id, status, content_type, after_episode_full, scheduled_at, slot_at, metadata, episodes!inner(deleted_at)',
          )
          .eq('platform_connection_id', connectionId)
          .eq('platform', 'youtube')
          .in('status', ['scheduled', 'deleting'])
          .not('metadata->youtube', 'is', null)
          .order('id')
          .range(from, to) as unknown as PromiseLike<{
          data: StagedRow[] | null;
          error: { message: string } | null;
        }>,
      'staged YouTube uploads',
    )
  ).flatMap((row) => {
    const staging = youtubeStagingOf(row.metadata);
    return staging && !staging.wentPublicAt ? [{ row, staging }] : [];
  });

  const refused = (row: StagedRow, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`${row.id}: ${message}`);
    return message;
  };

  const write = async (
    row: StagedRow,
    update: Record<string, unknown>,
    guard: { status: string; scheduledAt?: string | null },
  ) => {
    let query = client
      .from('publishes')
      .update(update)
      .eq('id', row.id)
      .eq('status', guard.status);

    if (guard.scheduledAt) query = query.eq('scheduled_at', guard.scheduledAt);

    const { error } = await query;
    if (error) {
      throw new Error(`Could not update publish ${row.id}: ${error.message}`);
    }
  };

  const withStaging = (row: StagedRow, staging: YouTubeStaging) =>
    ({ ...(row.metadata ?? {}), youtube: staging }) as unknown as Json;

  const fail = async (
    row: StagedRow,
    staging: YouTubeStaging,
    error: string,
    extra: Record<string, unknown> = {},
  ) => {
    await write(
      row,
      {
        status: 'failed',
        metadata: {
          ...(row.metadata ?? {}),
          youtube: staging,
          error,
          failedAt: now.toISOString(),
          ...extra,
        },
      },
      { status: 'scheduled' },
    );
    result.failed++;
  };

  /** Records a refusal on the row; the next run tries again */
  const keepError = async (
    row: StagedRow,
    staging: YouTubeStaging,
    error: unknown,
  ) => {
    const message = refused(row, error);
    await write(
      row,
      { metadata: withStaging(row, { ...staging, error: message }) },
      { status: row.status },
    );
  };

  // 1. Cancelled with their episode: deleted on YouTube, then here
  const live: Array<{ row: StagedRow; staging: YouTubeStaging }> = [];

  for (const entry of rows) {
    const { row, staging } = entry;
    const orphaned =
      (row.status === 'deleting' && !!staging.orphanedAt) ||
      (row.status === 'scheduled' && !!row.episodes?.deleted_at);

    if (!orphaned) {
      if (row.status === 'scheduled') live.push(entry);
      continue;
    }

    try {
      await api.deleteVideo(staging.videoId);
      const { error } = await client
        .from('publishes')
        .delete()
        .eq('id', row.id)
        .eq('status', row.status);
      if (error) {
        throw new Error(`Could not remove publish ${row.id}: ${error.message}`);
      }
      result.deleted++;
    } catch (error) {
      await keepError(row, staging, error);
    }
  }

  if (live.length === 0) return result;

  // 2. What YouTube did with each
  const readiness = await api.readiness(live.map((e) => e.staging.videoId));
  const pending: typeof live = [];

  for (const entry of live) {
    const { row, staging } = entry;
    const video = readiness.get(staging.videoId);
    result.checked++;

    if (!video) {
      await fail(row, staging, YOUTUBE_GONE_BEFORE_PUBLIC, {
        errorCode: 'YOUTUBE_VIDEO_GONE',
      });
      continue;
    }

    const verdict = readinessVerdict(video);

    if (verdict.state === 'public') {
      const at =
        !staging.goLiveWhenReady &&
        Date.parse(staging.publishAt) <= now.getTime()
          ? staging.publishAt
          : now.toISOString();

      await write(
        row,
        {
          status: 'published',
          published_at: at,
          metadata: withStaging(row, {
            ...staging,
            wentPublicAt: now.toISOString(),
          }),
        },
        { status: 'scheduled' },
      );
      result.published++;
      continue;
    }

    if (verdict.state === 'failed') {
      await fail(row, staging, verdict.error, {
        errorCode: 'YOUTUBE_PROCESSING_FAILED',
        [YOUTUBE_PROCESSING_KEY]: {
          state: 'failed',
          reason: verdict.reason,
          checkedAt: now.toISOString(),
        },
      });
      continue;
    }

    pending.push(entry);
  }

  /** A breaking post: public now if ready, flagged after six hours if not */
  const goLiveWhenReady = async (row: StagedRow, staging: YouTubeStaging) => {
    const verdict = readinessVerdict(readiness.get(staging.videoId)!);

    if (verdict.state !== 'ready') {
      if (!staging.alert && heldTooLong(staging, now)) {
        await write(
          row,
          { metadata: withStaging(row, { ...staging, alert: HELD_ALERT }) },
          { status: 'scheduled' },
        );
        result.held++;
      }
      return;
    }

    const outcome = await api.makePublic(staging.videoId);

    if (outcome === 'gone') {
      await fail(row, staging, YOUTUBE_GONE_BEFORE_PUBLIC, {
        errorCode: 'YOUTUBE_VIDEO_GONE',
      });
      return;
    }

    const { error: _cleared, ...rest } = staging;
    await write(
      row,
      {
        status: 'published',
        published_at: now.toISOString(),
        metadata: withStaging(row, {
          ...rest,
          publishAt: now.toISOString(),
          wentPublicAt: now.toISOString(),
        }),
      },
      { status: 'scheduled' },
    );
    result.madePublic++;
    result.published++;
  };

  // A Short waits for its long video to be public, which step 2 just read
  const longVideos = await longVideoStates(
    client,
    pending.map((e) => e.row),
  );

  for (const { row, staging: read } of pending) {
    let staging = read;
    let scheduledAt = row.scheduled_at;

    try {
      if (staging.goLiveWhenReady) {
        await goLiveWhenReady(row, staging);
        continue;
      }

      // 3. A time moved here moves on YouTube
      if (scheduledAt && !sameTime(scheduledAt, staging.publishAt)) {
        const soonest = now.getTime() + 60_000;
        const target =
          Date.parse(scheduledAt) > soonest
            ? scheduledAt
            : heldPublishAt(now.toISOString(), now).toISOString();
        const outcome = await api.updatePublishAt(staging.videoId, target);

        if (outcome === 'gone') {
          await fail(row, staging, YOUTUBE_GONE_BEFORE_PUBLIC, {
            errorCode: 'YOUTUBE_VIDEO_GONE',
          });
          continue;
        }

        if (outcome === 'public') continue;

        const { error: _cleared, ...rest } = staging;
        staging = { ...rest, publishAt: target };
        await write(
          row,
          { scheduled_at: target, metadata: withStaging(row, staging) },
          { status: 'scheduled', scheduledAt },
        );
        scheduledAt = target;
        result.moved++;
      }

      // 4. The HD gate
      if (Date.parse(staging.publishAt) > now.getTime() + HD_GATE_WINDOW_MS) {
        continue;
      }

      const video = readiness.get(staging.videoId)!;
      const verdict = readinessVerdict(video);
      let reason: YouTubeHoldReason | null =
        verdict.state === 'hold' ? verdict.reason : null;

      if (row.after_episode_full) {
        const longVideo = longVideos.get(row.id) ?? 'waiting';

        if (longVideo === 'gone') {
          await api.deleteVideo(staging.videoId);
          await fail(row, staging, LONG_VIDEO_NEVER_WENT_OUT);
          continue;
        }

        if (longVideo === 'waiting') reason ??= 'waiting_for_long_video';
      }

      if (!reason) continue;

      const to = heldPublishAt(staging.publishAt, now);
      const outcome = await api.updatePublishAt(
        staging.videoId,
        to.toISOString(),
      );

      if (outcome === 'gone') {
        await fail(row, staging, YOUTUBE_GONE_BEFORE_PUBLIC, {
          errorCode: 'YOUTUBE_VIDEO_GONE',
        });
        continue;
      }

      if (outcome === 'public') continue;

      await write(
        row,
        {
          scheduled_at: to.toISOString(),
          metadata: withStaging(row, withHold(staging, { now, to, reason })),
        },
        { status: 'scheduled', scheduledAt },
      );
      result.held++;
    } catch (error) {
      await keepError(row, staging, error);
    }
  }

  return result;
}
