import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { MeasuredEngagementCounts } from '@kit/clickhouse';

import {
  type DigestInputs,
  type DigestPublish,
  type DigestTrendComment,
  assembleDigest,
  canonicalJson,
  localDay,
} from '../src/lib/daily-digest';
import {
  NO_VIDEO_FIGURES,
  type VideoDailyFigures,
  type VideoLifetimeFigures,
} from '../src/lib/daily-figures';

/**
 * FILM-1736. The digest a per-episode morning report is written from: each
 * episode's long video and Shorts by platform, each video's engagement
 * rate (the Content tab's), its retention in its platform's own kind, and
 * its last seven days with the comments read on each.
 */

const PROJECT = '00000000-0000-4000-8000-0000000000b1';
const CH_YT = '00000000-0000-4000-8000-0000000000c1';
const CH_FB = '00000000-0000-4000-8000-0000000000c2';
const CH_IG = '00000000-0000-4000-8000-0000000000c3';

const YT_LONG = '00000000-0000-4000-8000-0000000000a1';
const FB_LONG = '00000000-0000-4000-8000-0000000000a2';
const YT_SHORT = '00000000-0000-4000-8000-0000000000a3';
const IG_REEL = '00000000-0000-4000-8000-0000000000a4';
const FB_REEL = '00000000-0000-4000-8000-0000000000a5';
const OLD_LONG = '00000000-0000-4000-8000-0000000000a6';
const OLD_SHORT = '00000000-0000-4000-8000-0000000000a7';
const PEER_LONG = '00000000-0000-4000-8000-0000000000a8';
const PEER_SHORT = '00000000-0000-4000-8000-0000000000a9';

const DAY = localDay('2026-10-17', 'Asia/Kolkata');

const YT_1 = { id: 'g-yt-1', name: 'YT 1', title: 'Who opened the vault?' };
const IGFB_1 = { id: 'g-igfb-1', name: 'IG/FB 1', title: null };

function publish(
  id: string,
  episodeId: string,
  platform: string,
  contentType: string,
  connectionId: string,
  publishedAt: string,
  extra: Partial<DigestPublish> = {},
): DigestPublish {
  return {
    id,
    episodeId,
    title: `${platform} ${contentType}`,
    episodeTitle: `Episode ${episodeId}`,
    platform,
    contentType,
    connectionId,
    url: null,
    publishedAt,
    shortsGroup: null,
    ...extra,
  };
}

function day(
  publishId: string,
  platform: string,
  date: string,
  figures: Partial<VideoDailyFigures>,
  source: VideoDailyFigures['source'],
): VideoDailyFigures {
  return {
    publishId,
    date,
    platform,
    ...NO_VIDEO_FIGURES,
    ...figures,
    source,
  };
}

function lifetime(
  publishId: string,
  platform: string,
  figures: Partial<VideoLifetimeFigures>,
  source: VideoLifetimeFigures['source'],
): VideoLifetimeFigures {
  return {
    publishId,
    platform,
    asOf: '2026-10-17',
    ...NO_VIDEO_FIGURES,
    ...figures,
    source,
  };
}

const counts = (
  views: number | null,
  likes: number,
  comments: number,
  shares: number,
): MeasuredEngagementCounts => ({ views, likes, comments, shares });

function comment(
  publishId: string,
  commentedAt: string,
  labelled = true,
): DigestTrendComment {
  return {
    publishId,
    commentedAt,
    label: labelled ? { sentiment: 'positive', topics: ['story'] } : null,
  };
}

function inputs(): DigestInputs {
  return {
    projectId: PROJECT,
    day: DAY,
    storeOff: null,
    freshness: [],
    channels: [],
    channelFigures: [],
    publishes: [
      publish(YT_LONG, 'e1', 'youtube', 'full', CH_YT, '2026-10-15T12:00:00Z'),
      publish(FB_LONG, 'e1', 'facebook', 'full', CH_FB, '2026-10-15T13:00:00Z'),
      publish(
        YT_SHORT,
        'e1',
        'youtube',
        'short',
        CH_YT,
        '2026-10-16T06:00:00Z',
        {
          shortsGroup: YT_1,
        },
      ),
      publish(
        IG_REEL,
        'e1',
        'instagram',
        'short',
        CH_IG,
        '2026-10-16T08:00:00Z',
        {
          shortsGroup: IGFB_1,
          title: 'The vault opens',
        },
      ),
      publish(
        FB_REEL,
        'e1',
        'facebook',
        'short',
        CH_FB,
        '2026-10-16T09:00:00Z',
        {
          shortsGroup: IGFB_1,
          title: 'The vault opens',
        },
      ),
      // Episode 2: its long video is old and quiet, its Short is recent
      publish(OLD_LONG, 'e2', 'youtube', 'full', CH_YT, '2026-08-01T10:00:00Z'),
      publish(
        OLD_SHORT,
        'e2',
        'youtube',
        'short',
        CH_YT,
        '2026-10-14T10:00:00Z',
        {
          title: 'Old short',
        },
      ),
      // Episode 3: old and quiet, not listed; only compared with
      publish(
        PEER_LONG,
        'e3',
        'youtube',
        'full',
        CH_YT,
        '2026-05-01T10:00:00Z',
      ),
      publish(
        PEER_SHORT,
        'e3',
        'youtube',
        'short',
        CH_YT,
        '2026-05-02T10:00:00Z',
      ),
    ],
    videoDay: [
      day(
        YT_LONG,
        'youtube',
        '2026-10-17',
        {
          views: 200,
          likes: 20,
          dislikes: 2,
          comments: 5,
          shares: 5,
          watchTimeSeconds: 6000,
        },
        'analytics_api',
      ),
      day(
        YT_LONG,
        'youtube',
        '2026-10-17',
        { views: 210, likes: 21, dislikes: 2, comments: 6 },
        'data_api',
      ),
      day(
        YT_LONG,
        'youtube',
        '2026-10-16',
        { views: 100, likes: 10, comments: 0, shares: 0 },
        'analytics_api',
      ),
      day(
        FB_LONG,
        'facebook',
        '2026-10-17',
        { views: null, likes: 4, comments: 1, shares: 0 },
        'graph_api',
      ),
      day(
        IG_REEL,
        'instagram',
        '2026-10-17',
        { views: 300, likes: 30, comments: 3, shares: 3 },
        'graph_api',
      ),
    ],
    videoLifetime: [
      lifetime(
        YT_LONG,
        'youtube',
        { avgPercentViewed: 45.5, avgViewDurationSeconds: 120 },
        'analytics_api',
      ),
      lifetime(OLD_LONG, 'youtube', { avgPercentViewed: 50 }, 'analytics_api'),
      lifetime(PEER_LONG, 'youtube', { avgPercentViewed: 40 }, 'analytics_api'),
      lifetime(YT_SHORT, 'youtube', { avgPercentViewed: 90 }, 'analytics_api'),
      lifetime(
        OLD_SHORT,
        'youtube',
        { avgPercentViewed: 100 },
        'analytics_api',
      ),
      lifetime(
        PEER_SHORT,
        'youtube',
        { avgPercentViewed: 80 },
        'analytics_api',
      ),
      lifetime(
        IG_REEL,
        'instagram',
        { reelsSkipRate: 0.35, reelsAvgWatchTimeMs: 5400 },
        'graph_api',
      ),
    ],
    engagementCounts: {
      day: new Map([
        [YT_LONG, counts(200, 20, 5, 5)],
        [FB_LONG, counts(null, 4, 1, 0)],
        [IG_REEL, counts(300, 30, 3, 3)],
      ]),
      lifetime: new Map([
        [YT_LONG, counts(1003, 51, 30, 20)],
        [FB_LONG, counts(null, 9, 2, 1)],
        [IG_REEL, counts(900, 60, 20, 10)],
        [OLD_SHORT, counts(0, 0, 0, 0)],
      ]),
    },
    viewsAtAge: new Map(),
    retentionCurves: new Map([
      [
        YT_LONG,
        [
          { elapsedRatio: 0, audienceWatchRatio: 1 },
          { elapsedRatio: 0.3, audienceWatchRatio: 0.6 },
          { elapsedRatio: 1, audienceWatchRatio: 0.4 },
        ],
      ],
      [
        FB_LONG,
        [
          { elapsedRatio: 0, audienceWatchRatio: 1 },
          { elapsedRatio: 0.5, audienceWatchRatio: 0.5 },
          { elapsedRatio: 1, audienceWatchRatio: 0.2 },
        ],
      ],
    ]),
    traffic: [],
    audience: null,
    comments: [],
    trendComments: [
      // 21 labelled in IST's 17th: shares
      ...Array.from({ length: 21 }, (_, i) =>
        comment(
          YT_LONG,
          `2026-10-17T${String(i % 18).padStart(2, '0')}:00:00.000Z`,
        ),
      ),
      // 00:30 IST on the 17th, still the 16th in UTC: the 17th's
      comment(YT_LONG, '2026-10-16T19:00:00.000Z', false),
      // 23:30 IST on the 16th: the 16th's
      comment(YT_LONG, '2026-10-16T18:00:00.000Z'),
    ],
    reactions: [
      {
        publishId: YT_LONG,
        reaction: { kind: 'no_comments' },
        disclosure: null,
      },
      {
        publishId: IG_REEL,
        reaction: { kind: 'not_read', reason: 'never_synced' },
        disclosure: null,
      },
      {
        publishId: FB_LONG,
        reaction: { kind: 'not_read', reason: 'not_authorised' },
        disclosure: null,
      },
    ],
    commentsDisclosure: null,
    posts: [],
    scheduledThrough: [],
    revenue: { rows: [], access: [] },
  };
}

const video = (inputs_: DigestInputs, id: string) =>
  assembleDigest(inputs_).videos.find((v) => v.publishId === id)!;

const hash = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');

describe('episodes', () => {
  it('groups each episode’s long video and Shorts by platform, newest episode first', () => {
    expect(assembleDigest(inputs()).episodes).toEqual([
      {
        episodeId: 'e1',
        episodeTitle: 'Episode e1',
        publishedAt: '2026-10-15T12:00:00Z',
        long: [
          { platform: 'facebook', publishId: FB_LONG },
          { platform: 'youtube', publishId: YT_LONG },
        ],
        shorts: [
          {
            key: 'group:g-yt-1',
            shortsGroupId: 'g-yt-1',
            name: 'YT 1',
            title: 'Who opened the vault?',
            publishedAt: '2026-10-16T06:00:00Z',
            publishes: [{ platform: 'youtube', publishId: YT_SHORT }],
          },
          {
            key: 'group:g-igfb-1',
            shortsGroupId: 'g-igfb-1',
            name: 'IG/FB 1',
            // The group has no title: its posts' title
            title: 'The vault opens',
            publishedAt: '2026-10-16T08:00:00Z',
            publishes: [
              { platform: 'facebook', publishId: FB_REEL },
              { platform: 'instagram', publishId: IG_REEL },
            ],
          },
        ],
        other: [],
      },
      {
        episodeId: 'e2',
        episodeTitle: 'Episode e2',
        publishedAt: '2026-08-01T10:00:00Z',
        long: [{ platform: 'youtube', publishId: OLD_LONG }],
        shorts: [
          {
            key: `post:${OLD_SHORT}`,
            shortsGroupId: null,
            name: null,
            title: 'Old short',
            publishedAt: '2026-10-14T10:00:00Z',
            publishes: [{ platform: 'youtube', publishId: OLD_SHORT }],
          },
        ],
        other: [],
      },
    ]);
  });

  it('lists an old, quiet long video because its episode’s Short is listed, and every entry under videos', () => {
    const digest = assembleDigest(inputs());
    const listed = new Map(
      digest.videos.map((v) => [v.publishId, v.listedBecause]),
    );

    expect(listed.get(OLD_LONG)).toBe('same_episode');
    expect(listed.get(OLD_SHORT)).toBe('under_30_days_old');
    expect(listed.has(PEER_LONG)).toBe(false);

    const named = digest.episodes.flatMap((e) => [
      ...e.long,
      ...e.shorts.flatMap((s) => s.publishes),
    ]);
    expect(named.map((n) => n.publishId).sort()).toEqual([...listed.keys()]);
  });
});

describe('dislikes on a platform that has none', () => {
  it('are null with “no dislikes on this platform”, never 0, on the day, through it and in the trend', () => {
    for (const id of [FB_LONG, IG_REEL]) {
      const v = video(inputs(), id);
      const today = v.day[0]!;

      expect(today.figures.dislikes).toBeNull();
      expect(today.notMeasured.dislikes).toBe('No dislikes on this platform.');
      const trendDay = v.trend.at(-1)!.sources[0]!;
      expect(trendDay.figures.dislikes).toBeNull();
      expect(trendDay.notMeasured.dislikes).toBe(
        'No dislikes on this platform.',
      );
    }

    expect(video(inputs(), YT_LONG).day[0]!.figures.dislikes).toBe(2);
  });
});

describe('engagement rate', () => {
  it('is (likes + comments + shares) / views on the day and through it', () => {
    const rate = video(inputs(), YT_LONG).engagementRate;

    // (20 + 5 + 5) / 200 and (51 + 30 + 20) / 1003
    expect(rate.day).toMatchObject({ percent: 15 });
    expect(rate.lifetime).toMatchObject({ percent: 10.07 });
    expect(rate.lifetime.denominator).toMatch(/^Divided by views/);
    expect(video(inputs(), IG_REEL).engagementRate.day).toMatchObject({
      percent: 12,
    });
  });

  it('is null with its reason when views are not measured, zero, or not stored', () => {
    expect(video(inputs(), FB_LONG).engagementRate.day).toEqual({
      percent: null,
      reason:
        'Facebook reports no single view count, so there are no views to divide by.',
    });
    expect(video(inputs(), OLD_SHORT).engagementRate.lifetime).toEqual({
      percent: null,
      reason: 'No views to divide by.',
    });
    expect(video(inputs(), YT_SHORT).engagementRate.lifetime).toEqual({
      percent: null,
      reason: 'No views stored for this video from YouTube yet.',
    });

    const off = 'Not measured: the analytics store is switched off.';
    expect(
      video({ ...inputs(), storeOff: off }, YT_SHORT).engagementRate.day,
    ).toEqual({ percent: null, reason: off });
  });
});

describe('retention, in each platform’s own kind', () => {
  it('YouTube: average percentage viewed and duration, the steepest drop, and the median of the channel’s same kind', () => {
    expect(video(inputs(), YT_LONG).retention).toEqual({
      kind: 'avg_percent_viewed',
      asOf: '2026-10-17',
      avgPercentViewed: 45.5,
      avgViewDurationSeconds: 120,
      // OLD_LONG 50 and PEER_LONG 40; the Shorts are left out
      channelMedianAvgPercentViewed: 45,
      channelVideosCompared: 2,
      dropOff: { from: 0, to: 0.3, drop: 0.4 },
      notMeasured: {},
    });
    // A Short against the channel's Shorts: OLD_SHORT 100 and PEER_SHORT 80
    expect(video(inputs(), YT_SHORT).retention).toMatchObject({
      kind: 'avg_percent_viewed',
      avgPercentViewed: 90,
      channelMedianAvgPercentViewed: 90,
      channelVideosCompared: 2,
      dropOff: null,
      notMeasured: {
        avgViewDurationSeconds: 'Not reported by YouTube for this video yet.',
        dropOff: 'YouTube has not reported this video’s curve yet.',
      },
    });
  });

  it('Facebook: its curve, against its channel’s videos of the same kind', () => {
    expect(video(inputs(), FB_LONG).retention).toMatchObject({
      kind: 'curve',
      curve: expect.arrayContaining([
        { position: 0.5, retention: 0.5, channelMedian: null },
      ]),
      dropOff: { from: 0, to: 0.5, drop: 0.5 },
      channelVideosCompared: 0,
      notMeasured: {},
    });
    expect(video(inputs(), FB_REEL).retention).toMatchObject({
      kind: 'curve',
      curve: null,
      notMeasured: {
        curve: 'Facebook has not reported this video’s curve yet.',
      },
    });
  });

  it('Instagram: the Reels skip rate and average watch time', () => {
    expect(video(inputs(), IG_REEL).retention).toEqual({
      kind: 'skip_rate',
      asOf: '2026-10-17',
      reelsSkipRate: 0.35,
      reelsAvgWatchTimeMs: 5400,
      notMeasured: {},
    });
  });

  it('the young videos’ curve section reads Facebook’s curve too', () => {
    const section = assembleDigest(inputs()).retention;

    expect(section.find((r) => r.publishId === FB_LONG)).toMatchObject({
      channelVideosCompared: 0,
      steepestDrop: { from: 0, to: 0.5, drop: 0.5 },
    });
    expect(section.find((r) => r.publishId === IG_REEL)).toMatchObject({
      curve: null,
      reason: expect.stringMatching(/^Only YouTube and Facebook/),
    });
  });
});

describe('the seven-day trend', () => {
  it('runs from six days before the report day to it, each source with its own engagement rate', () => {
    const trend = video(inputs(), YT_LONG).trend;

    expect(trend.map((d) => d.date)).toEqual([
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
    ]);
    expect(trend.at(-1)!.sources).toEqual([
      {
        source: 'analytics_api',
        figures: {
          views: 200,
          likes: 20,
          dislikes: 2,
          comments: 5,
          watchTimeSeconds: 6000,
          engagementRate: 15,
        },
        notMeasured: {},
      },
      {
        source: 'data_api',
        figures: {
          views: 210,
          likes: 21,
          dislikes: 2,
          comments: 6,
          watchTimeSeconds: null,
          // (21 + 6) / 210: the live counts carry no shares
          engagementRate: 12.86,
        },
        notMeasured: {
          watchTimeSeconds: 'Not reported by YouTube for this day yet.',
        },
      },
    ]);
    expect(trend.at(-2)!.sources[0]!.figures.engagementRate).toBe(10);
    expect(trend[0]).toMatchObject({
      sources: [],
      notMeasured: {
        sources: 'No source has reported this video for this day yet.',
      },
    });
  });

  it('the stored source’s rate on the day is the video’s engagement rate for the day', () => {
    const v = video(inputs(), YT_LONG);

    expect(v.trend.at(-1)!.sources[0]!.figures.engagementRate).toBe(
      v.engagementRate.day.percent,
    );
  });

  it('counts the comments read in each day of the zone, with shares from 20 labelled and counts only below', () => {
    const trend = video(inputs(), YT_LONG).trend;
    const today = trend.at(-1)!.comments!;
    const before = trend.at(-2)!.comments!;

    expect(today).toMatchObject({
      comments: 22,
      labelled: 21,
      sentiment: { positive: 21, neutral: 0, negative: 0 },
      topics: expect.objectContaining({ story: 21, question: 0 }),
      shares: {
        kind: 'shares',
        labelled: 21,
        sentiment: { positive: 100, neutral: 0, negative: 0 },
      },
    });
    expect(before).toMatchObject({
      comments: 1,
      labelled: 1,
      sentiment: { positive: 1, neutral: 0, negative: 0 },
      shares: { kind: 'too_few', labelled: 1, needed: 20 },
    });
    expect(trend[0]!.comments).toMatchObject({ comments: 0, labelled: 0 });
  });

  it('says why a video’s comments were not counted, never 0', () => {
    const reel = video(inputs(), IG_REEL).trend.at(-1)!;
    expect(reel.comments).toBeNull();
    expect(reel.notMeasured.comments).toBe(
      'StoryBook has not read this video’s comments yet.',
    );
    expect(video(inputs(), FB_LONG).trend.at(-1)!.notMeasured.comments).toBe(
      'The channel has not granted StoryBook its comments.',
    );
  });
});

describe('the same facts give the same digest', () => {
  it('twice, and whatever order the reads returned them in', () => {
    const base = inputs();
    const shuffled: DigestInputs = {
      ...base,
      publishes: [...base.publishes].reverse(),
      videoDay: [...base.videoDay].reverse(),
      videoLifetime: [...base.videoLifetime].reverse(),
      trendComments: [...base.trendComments].reverse(),
      reactions: [...base.reactions].reverse(),
      retentionCurves: new Map([...base.retentionCurves].reverse()),
      engagementCounts: {
        day: new Map([...base.engagementCounts.day].reverse()),
        lifetime: new Map([...base.engagementCounts.lifetime].reverse()),
      },
    };

    expect(hash(assembleDigest(inputs()))).toBe(hash(assembleDigest(base)));
    expect(hash(assembleDigest(shuffled))).toBe(hash(assembleDigest(base)));
  });

  it('and a changed comment changes the hash', () => {
    const changed = inputs();
    changed.trendComments.pop();

    expect(hash(assembleDigest(changed))).not.toBe(
      hash(assembleDigest(inputs())),
    );
  });
});
