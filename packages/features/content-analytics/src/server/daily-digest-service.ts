import 'server-only';

import { createHash } from 'node:crypto';

import {
  queryRetentionCurves,
  queryTotalsByVideoIds,
} from '@kit/clickhouse/server';
import {
  readPublishCalendar,
  readRecentlyMovedPosts,
  readScheduledThrough,
} from '@kit/publishing/server/publish-calendar';
import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';

import {
  AGE_CHECKPOINTS,
  type DigestComment,
  type DigestInputs,
  type DigestPublish,
  type DigestTrendComment,
  RECENT_VIDEO_DAYS,
  TREND_DAYS,
  UPCOMING_DAYS,
  addDays,
  assembleDigest,
  canonicalJson,
  listedVideos,
  localDay,
} from '../lib/daily-digest';
import type { AnalyticsClient } from './analytics-client';
import {
  type StoredComment,
  getCommentReactions,
  labelOf,
  listAudienceComments,
} from './audience-comments-service';
import { listProjectChannels } from './channels';
import {
  figuresUnmeasuredReason,
  getChannelDailyFigures,
  getDataFreshness,
  getVideoAudienceBreakdown,
  getVideoDailyFigures,
  getVideoLifetimeFigures,
} from './daily-figures';
import { getTrafficBreakdownService } from './deep-dive-service';
import { readAccountRevenueAccess } from './revenue-access-reader';
import { assertProjectAccess } from './scope-access';
import { getVideoLogService } from './video-log-service';

/**
 * FILM-1735. `get_daily_digest`: everything a morning report says about a
 * project's day, read once and assembled by `assembleDigest`. The day runs
 * from local midnight to local midnight in `timezone`; platform figures are
 * by the platform's own data day, `date`. FILM-1736 reads seven days of
 * figures and comments for each video's trend, and lifetime figures for
 * every video, which the retention medians compare with.
 *
 * The project is checked on the caller's client before anything is read,
 * and every ClickHouse read is keyed by publish or channel ids that client
 * returned (the pattern in diagnostics-service.ts).
 */

/** At most this many of a day's comments are read into a digest */
export const MAX_DIGEST_COMMENTS = 2_000;

const DAY_MS = 86_400_000;

export interface DailyDigestResult {
  digest: ReturnType<typeof assembleDigest>;
  /** sha256 of the digest's canonical JSON */
  digestHash: string;
}

export function hashDigest(digest: unknown) {
  return createHash('sha256').update(canonicalJson(digest)).digest('hex');
}

interface PublishRow {
  id: string;
  episode_id: string;
  title: string | null;
  platform: string;
  content_type: string;
  platform_connection_id: string | null;
  platform_url: string | null;
  published_at: string | null;
  status: string;
  shortsGroupId: string | null;
  episodes: { title: string | null; shorts_groups: unknown };
}

/** The group a Short names, from its episode's shorts_groups */
function shortsGroupOf(row: PublishRow): DigestPublish['shortsGroup'] {
  if (!row.shortsGroupId) return null;

  const groups = Array.isArray(row.episodes.shorts_groups)
    ? (row.episodes.shorts_groups as Array<Record<string, unknown>>)
    : [];
  const group = groups.find((g) => g?.id === row.shortsGroupId);
  const text = (value: unknown) =>
    typeof value === 'string' && value ? value : null;

  return {
    id: row.shortsGroupId,
    name: text(group?.name),
    title: text(group?.title),
  };
}

async function projectPublishes(
  client: AnalyticsClient,
  projectId: string,
): Promise<DigestPublish[]> {
  const rows = await fetchAllRows<PublishRow>(
    (from, to) =>
      client
        .from('publishes')
        .select(
          'id, episode_id, title, platform, content_type, platform_connection_id, platform_url, published_at, status, shortsGroupId:metadata->>shortsGroupId, episodes!inner(title, project_id, shorts_groups)',
        )
        .eq('episodes.project_id', projectId)
        .in('status', ['published', 'unlisted'])
        .order('id')
        .range(from, to),
    'digest publishes',
  );

  return rows.map((row) => ({
    id: row.id,
    episodeId: row.episode_id,
    title: row.title,
    episodeTitle: row.episodes.title,
    platform: row.platform,
    contentType: row.content_type,
    connectionId: row.platform_connection_id,
    url: row.platform_url,
    publishedAt: row.published_at,
    shortsGroup: shortsGroupOf(row),
  }));
}

async function dayComments(
  client: AnalyticsClient,
  projectId: string,
  window: { start: string; end: string },
) {
  const comments: DigestComment[] = [];
  let after: { commentedAt: string; id: string } | undefined;

  do {
    const page = await listAudienceComments(
      client,
      { projectId },
      { since: window.start, until: window.end, limit: 50, after },
    );

    for (const comment of page.comments) {
      const label = labelOf(comment);

      comments.push({
        id: comment.id,
        publishId: comment.publish_id,
        text: comment.text,
        replyCount: comment.reply_count,
        isReply: comment.parent_platform_comment_id !== null,
        commentedAt: comment.commented_at,
        label: label
          ? { sentiment: label.sentiment, topics: label.topics }
          : null,
      });
    }

    after = page.next ?? undefined;
  } while (after && comments.length < MAX_DIGEST_COMMENTS);

  return comments;
}

/** Every comment on the videos in the window, with its label: counted, so never capped */
async function trendComments(
  client: AnalyticsClient,
  publishIds: string[],
  window: { start: string; end: string },
): Promise<DigestTrendComment[]> {
  const rows = await fetchAllByIds<
    Pick<StoredComment, 'id' | 'publish_id' | 'commented_at' | 'comment_labels'>
  >(
    publishIds,
    (chunk, from, to) =>
      client
        .from('audience_comments')
        .select(
          'id, publish_id, commented_at, comment_labels(sentiment, topics, source, model)',
        )
        .in('publish_id', chunk)
        .gte('commented_at', window.start)
        .lt('commented_at', window.end)
        .order('id')
        .range(from, to),
    'digest trend comments',
  );

  return rows.map((row) => {
    const label = labelOf(row);

    return {
      publishId: row.publish_id,
      commentedAt: row.commented_at,
      label: label
        ? { sentiment: label.sentiment, topics: label.topics }
        : null,
    };
  });
}

async function dayRevenue(
  client: AnalyticsClient,
  publishIds: string[],
  date: string,
) {
  const rows = await fetchAllByIds<{
    id: string;
    publish_id: string | null;
    currency: string | null;
    revenue_cents: number | null;
  }>(
    publishIds,
    (chunk, from, to) =>
      client
        .from('revenue_records')
        .select('id, publish_id, currency, revenue_cents')
        .in('publish_id', chunk)
        .eq('record_date', date)
        .order('id')
        .range(from, to),
    'digest revenue',
  );

  return rows
    .filter((row) => row.publish_id && row.revenue_cents !== null)
    .map((row) => ({
      publishId: row.publish_id!,
      currency: row.currency,
      cents: row.revenue_cents!,
    }));
}

export async function getDailyDigestService(
  client: AnalyticsClient,
  input: { projectId: string; date: string; timezone: string },
): Promise<DailyDigestResult> {
  const accountId = await assertProjectAccess(client, input.projectId);
  const day = localDay(input.date, input.timezone);

  const [publishes, channels, freshness] = await Promise.all([
    projectPublishes(client, input.projectId),
    listProjectChannels(input.projectId, client),
    getDataFreshness(client, { projectId: input.projectId }),
  ]);

  const publishIds = publishes.map((p) => p.id);
  const connectionIds = channels.map((c) => c.connectionId).sort();

  const [channelFigures, videoDay] = await Promise.all([
    connectionIds.length
      ? getChannelDailyFigures(client, {
          connectionIds,
          from: addDays(input.date, -28),
          to: input.date,
        })
      : [],
    publishIds.length
      ? getVideoDailyFigures(client, {
          publishIds,
          from: addDays(input.date, -(TREND_DAYS - 1)),
          to: input.date,
        })
      : [],
  ]);

  const base: DigestInputs = {
    projectId: input.projectId,
    day,
    storeOff: figuresUnmeasuredReason(),
    freshness,
    channels: channels.map((c) => ({
      connectionId: c.connectionId,
      platform: c.platform,
      name: c.name,
    })),
    channelFigures,
    publishes,
    videoDay,
    videoLifetime: [],
    engagementCounts: { day: new Map(), lifetime: new Map() },
    viewsAtAge: new Map(),
    retentionCurves: new Map(),
    traffic: [],
    audience: null,
    comments: [],
    trendComments: [],
    reactions: [],
    commentsDisclosure: null,
    posts: [],
    scheduledThrough: [],
    revenue: { rows: [], access: [] },
  };

  const listedIds = listedVideos(base).map((v) => v.publish.id);
  const curveIds = publishes
    .filter((p) => p.platform === 'youtube' || p.platform === 'facebook')
    .map((p) => p.id);
  // The ids came from this project through RLS: the project bound changes
  // what is scanned, never what is returned
  const scope = { projectIds: [input.projectId] };

  const [
    videoLifetime,
    engagementDay,
    engagementLifetime,
    weekComments,
    audience,
    videoLog,
    retentionCurves,
    traffic,
    comments,
    reactions,
    calendarPosts,
    scheduledThrough,
    revenueRows,
    revenueAccess,
    movedPosts,
  ] = await Promise.all([
    publishIds.length
      ? getVideoLifetimeFigures(client, { publishIds, asOf: day.end })
      : [],
    // The Content tab's read (getContentList), on the day and through it
    queryTotalsByVideoIds(listedIds, {
      ...scope,
      startDate: input.date,
      endDate: input.date,
    }),
    queryTotalsByVideoIds(listedIds, { ...scope, endDate: input.date }),
    listedIds.length
      ? trendComments(client, listedIds, {
          start: localDay(
            addDays(input.date, -(TREND_DAYS - 1)),
            input.timezone,
          ).start,
          end: day.end,
        })
      : [],
    listedIds.length
      ? getVideoAudienceBreakdown(client, { publishIds: listedIds })
      : null,
    getVideoLogService(client, {
      projectId: input.projectId,
      checkpoints: [...AGE_CHECKPOINTS],
      publishedFrom: addDays(input.date, -(RECENT_VIDEO_DAYS + 1)),
      publishedTo: input.date,
      limit: 500,
      offset: 0,
      orderBy: 'published_at',
      orderDirection: 'desc',
    }),
    curveIds.length
      ? queryRetentionCurves({ videoIds: curveIds, ...scope })
      : new Map(),
    getTrafficBreakdownService(client, {
      scope: { projectId: input.projectId },
      bucket: 'day',
      from: new Date(`${input.date}T00:00:00Z`),
      to: new Date(`${input.date}T00:00:00Z`),
    }),
    dayComments(client, input.projectId, day),
    getCommentReactions(client, { projectId: input.projectId }),
    readPublishCalendar(client, {
      projectId: input.projectId,
      from: new Date(day.start),
      to: new Date(Date.parse(day.end) + UPCOMING_DAYS * DAY_MS),
    }),
    readScheduledThrough(client, {
      projectId: input.projectId,
      after: new Date(day.end),
      connectionIds,
    }),
    publishIds.length ? dayRevenue(client, publishIds, input.date) : [],
    readAccountRevenueAccess(client, accountId),
    // FILM-2213: posts moved in the day's last 24 hours, wherever they fall
    readRecentlyMovedPosts(client, {
      projectId: input.projectId,
      since: new Date(Date.parse(day.end) - DAY_MS),
    }),
  ]);

  const seen = new Set(calendarPosts.map((post) => post.publishId));
  const posts = [
    ...calendarPosts,
    ...movedPosts.filter((post) => !seen.has(post.publishId)),
  ];

  const digest = assembleDigest({
    ...base,
    videoLifetime,
    engagementCounts: { day: engagementDay, lifetime: engagementLifetime },
    trendComments: weekComments,
    audience,
    viewsAtAge: new Map(
      videoLog.map((row) => [row.videoId, row.viewsAtAge] as const),
    ),
    retentionCurves,
    traffic,
    comments,
    reactions: reactions.videos.map((video) => ({
      publishId: video.publish.id,
      reaction: video.reaction,
      disclosure: video.disclosure,
    })),
    commentsDisclosure: reactions.disclosure,
    posts,
    scheduledThrough,
    revenue: {
      rows: revenueRows,
      access: revenueAccess.map((note) => `${note.platform}: ${note.note}`),
    },
  });

  return { digest, digestHash: hashDigest(digest) };
}
