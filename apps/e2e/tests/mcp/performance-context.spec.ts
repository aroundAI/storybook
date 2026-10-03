import { expect, test } from '@playwright/test';

import {
  type SeededVideo,
  daysAgo,
  seedVideoDims,
  seedVideoMetricsBatch,
} from '../utils/clickhouse';
import { callMcpTool, mintPersonalAccessToken } from '../utils/mcp';
import {
  insertRow,
  seedProject,
  seedPublishedEpisode,
  seedSeason,
  seedTeamAccount,
  seedYouTubeConnection,
  serviceRoleAuth,
} from '../utils/seed';

/**
 * FILM-1912, end to end: `start_generation` for a story builds the
 * performance block once, on the token's client, from the local ClickHouse
 * through the FILM-1906 services, stores it on the run and briefs with it.
 * Eight published episodes with figures chosen so the ranking can be
 * worked out by hand below. Gated like the FILM-1906 evidence:
 * `CLICKHOUSE_EVIDENCE=1` with a server reading the local ClickHouse.
 */

// Per published episode (number = index + 1): average percentage viewed,
// and its views on publish day (all inside the first 7 days).
const PUBLISHED = [
  { retention: 41, views: 300 },
  { retention: 55, views: 120 },
  { retention: 38, views: 800 },
  { retention: 62, views: 450 },
  { retention: 47, views: 90 },
  { retention: 70, views: 600 },
  { retention: 44, views: 210 },
  { retention: 51, views: 500 },
];

// Retention, highest first: 6 (70), 4 (62), 2 (55) … 7 (44), 1 (41), 3 (38)
// Velocity, highest first:  3 (800), 6 (600), 8 (500) … 7 (210), 2 (120), 5 (90)

async function seedChannelProject(prefix: string, enabled: boolean) {
  const team = await seedTeamAccount({ emailPrefix: prefix });
  const connectionId = await seedYouTubeConnection(team.accountId);
  const project = await seedProject(team);
  const { seasonId } = await seedSeason(project.id);

  await insertRow(
    'account_ai_settings',
    { account_id: team.accountId, performance_context_enabled: enabled },
    serviceRoleAuth(),
  );

  return { team, connectionId, project, seasonId };
}

async function storyTarget(projectId: string, seasonId: string) {
  return insertRow<{ id: string }>(
    'episodes',
    {
      project_id: projectId,
      season_id: seasonId,
      number: 9,
      title: 'The Ninth Signal',
      description: 'A lighthouse keeper answers a signal from her own past.',
      slug: `ninth-${crypto.randomUUID().slice(0, 8)}`,
    },
    serviceRoleAuth(),
  );
}

async function readRunInput(runId: string) {
  const url = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:55321';
  const key = serviceRoleAuth().key;
  const response = await fetch(
    `${url}/rest/v1/generation_runs?id=eq.${runId}&select=input`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  const rows = (await response.json()) as Array<{
    input: Record<string, unknown>;
  }>;

  return rows[0]!.input;
}

interface Ranked {
  status: string;
  sample: number;
  group: { platform: string; contentType: string };
  top: Array<{ episodeNumber: number; value: number }>;
  bottom: Array<{ episodeNumber: number; value: number }>;
}

test.describe('MCP brief with past performance (FILM-1912)', () => {
  test.beforeEach(() => {
    test.skip(
      !process.env.CLICKHOUSE_EVIDENCE,
      'Set CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
    );
  });

  test('a story brief carries the hand-computed top and bottom episodes, stored on its run', async () => {
    const seeded = await seedChannelProject('perf-ctx-on', true);
    const videos: SeededVideo[] = [];
    const publishedAt = daysAgo(20);

    for (const [index] of PUBLISHED.entries()) {
      const episode = await seedPublishedEpisode(
        seeded.project.id,
        seeded.connectionId,
        {
          number: index + 1,
          seasonId: seeded.seasonId,
          title: `Published ${index + 1}`,
        },
      );

      videos.push({
        videoId: episode.publishId,
        projectId: seeded.project.id,
        accountId: seeded.team.accountId,
        connectionId: seeded.connectionId,
        title: `Published ${index + 1}`,
        publishedAt: new Date(publishedAt.getTime() + index * 3_600_000),
      });
    }

    await seedVideoDims(videos);
    await seedVideoMetricsBatch(
      PUBLISHED.map((figures, index) => ({
        video: videos[index]!,
        days: [
          {
            ageDays: 0,
            views: figures.views,
            avgViewPercentage: figures.retention,
          },
        ],
      })),
    );

    const target = await storyTarget(seeded.project.id, seeded.seasonId);
    const token = await mintPersonalAccessToken(seeded.team, {
      scopes: ['studio:read', 'studio:write'],
    });

    const started = await callMcpTool(token, 'start_generation', {
      stage: 'story',
      episodeId: target.id,
    });
    expect(started.isError, JSON.stringify(started)).toBe(false);

    const { run, brief } = started.structuredContent as {
      run: { runId: string };
      brief: {
        bytes: number;
        instructions: string;
        context: {
          performanceContext: {
            status: string;
            retention: Ranked;
            velocity: Ranked;
          };
        };
      };
    };
    const block = brief.context.performanceContext;
    const ends = (ranked: Ranked) => ({
      top: ranked.top.map((e) => [e.episodeNumber, e.value]),
      bottom: ranked.bottom.map((e) => [e.episodeNumber, e.value]),
    });

    expect(block.status).toBe('included');
    expect(block.retention).toMatchObject({
      status: 'ranked',
      sample: 8,
      group: { platform: 'youtube', contentType: 'long' },
    });
    expect(ends(block.retention)).toEqual({
      top: [
        [6, 70],
        [4, 62],
        [2, 55],
      ],
      bottom: [
        [3, 38],
        [1, 41],
        [7, 44],
      ],
    });
    expect(ends(block.velocity)).toEqual({
      top: [
        [3, 800],
        [6, 600],
        [8, 500],
      ],
      bottom: [
        [5, 90],
        [2, 120],
        [7, 210],
      ],
    });
    expect(brief.instructions).toContain('## Past performance of this project');
    expect(brief.bytes).toBeLessThan(60 * 1024);

    // Stored on the run: the block every later brief of it reads
    const input = await readRunInput(run.runId);
    expect(input.performanceContext).toEqual(block);
  });

  test('with the team setting off, the brief and the run carry no block', async () => {
    const seeded = await seedChannelProject('perf-ctx-off', false);
    const target = await storyTarget(seeded.project.id, seeded.seasonId);
    const token = await mintPersonalAccessToken(seeded.team, {
      scopes: ['studio:read', 'studio:write'],
    });

    const started = await callMcpTool(token, 'start_generation', {
      stage: 'story',
      episodeId: target.id,
    });
    expect(started.isError, JSON.stringify(started)).toBe(false);

    const { run, brief } = started.structuredContent as {
      run: { runId: string };
      brief: { instructions: string; context: Record<string, unknown> };
    };

    expect(brief.context).not.toHaveProperty('performanceContext');
    expect(brief.instructions).not.toContain('## Past performance');
    expect(await readRunInput(run.runId)).not.toHaveProperty(
      'performanceContext',
    );
  });
});
