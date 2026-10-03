import { expect, test } from '@playwright/test';

import {
  type SeededVideo,
  daysAgo,
  seedVideoDims,
  seedVideoMetricsBatch,
} from '../utils/clickhouse';
import { callMcpTool, mintPersonalAccessToken } from '../utils/mcp';
import {
  seedProject,
  seedPublishedEpisode,
  seedSeason,
  seedTeamAccount,
  seedYouTubeConnection,
  updateRows,
} from '../utils/seed';

/**
 * FILM-1912, integration: `get_performance_by_origin` over the real MCP
 * endpoint, reading the local ClickHouse through the same per-video read
 * the performance context uses. Four episodes published 20 days ago, two
 * written by StoryBook's model and two by an agent over MCP, with figures
 * whose medians are worked out by hand below. Gated like the FILM-1906
 * evidence: `CLICKHOUSE_EVIDENCE=1` with a server reading the local
 * ClickHouse (`deployment/config/local.env`).
 */

// Per episode: its story's origin, the views on each day after publishing,
// and its average percentage viewed. Velocity is views at ages 0–6 (the
// checkpoint sums days before day 7), so day 10's views never count.
const EPISODES = [
  {
    origin: 'server',
    days: [
      [0, 100],
      [3, 50],
      [10, 999],
    ],
    retention: 40,
  },
  {
    origin: 'server',
    days: [
      [0, 300],
      [3, 100],
    ],
    retention: 60,
  },
  { origin: 'external', days: [[0, 200]], retention: 50 },
  {
    origin: 'external',
    days: [
      [0, 500],
      [6, 100],
    ],
    retention: 70,
  },
] as const;

// server:   retention (40 + 60) / 2 = 50; velocity (150 + 400) / 2 = 275
// external: retention (50 + 70) / 2 = 60; velocity (200 + 600) / 2 = 400

test.describe('MCP performance by generation origin (FILM-1912)', () => {
  test('splits seeded episodes by who wrote them, with hand-computed medians', async () => {
    test.skip(
      !process.env.CLICKHOUSE_EVIDENCE,
      'Set CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
    );

    const team = await seedTeamAccount({ emailPrefix: 'perf-origin' });
    const connectionId = await seedYouTubeConnection(team.accountId);
    const project = await seedProject(team);
    const { seasonId } = await seedSeason(project.id);
    const token = await mintPersonalAccessToken(team, {
      scopes: ['studio:read'],
    });

    const publishedAt = daysAgo(20);
    const videos: SeededVideo[] = [];

    for (const [index, episode] of EPISODES.entries()) {
      const seeded = await seedPublishedEpisode(project.id, connectionId, {
        number: index + 1,
        seasonId,
        title: `Origin ${episode.origin} ${index + 1}`,
      });

      await updateRows('episodes', `id=eq.${seeded.episodeId}`, {
        generation_origin: {
          story: { kind: episode.origin, at: new Date().toISOString() },
        },
      });

      videos.push({
        videoId: seeded.publishId,
        projectId: project.id,
        accountId: team.accountId,
        connectionId,
        title: `Origin ${episode.origin} ${index + 1}`,
        publishedAt: new Date(publishedAt.getTime() + index * 3_600_000),
      });
    }

    await seedVideoDims(videos);
    await seedVideoMetricsBatch(
      EPISODES.map((episode, index) => ({
        video: videos[index]!,
        days: episode.days.map(([ageDays, views]) => ({
          ageDays,
          views,
          avgViewPercentage: episode.retention,
        })),
      })),
    );

    const result = await callMcpTool(token, 'get_performance_by_origin', {
      projectId: project.id,
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      data: {
        status: 'measured',
        stage: 'story',
        velocityDays: 7,
        groups: [
          {
            platform: 'youtube',
            contentType: 'long',
            origins: [
              {
                origin: 'server',
                videos: 2,
                retentionMedian: 50,
                retentionMeasured: 2,
                velocityMedian: 275,
                velocityMeasured: 2,
              },
              {
                origin: 'external',
                videos: 2,
                retentionMedian: 60,
                retentionMeasured: 2,
                velocityMedian: 400,
                velocityMeasured: 2,
              },
            ],
          },
        ],
      },
      notes: { measured: true, reason: null },
    });
  });
});
