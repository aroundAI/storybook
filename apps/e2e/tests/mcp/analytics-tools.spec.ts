import { expect, test } from '@playwright/test';

import {
  type SeededVideo,
  seedVideoDims,
  seedVideoMetricsBatch,
} from '../utils/clickhouse';
import {
  callMcpTool,
  listMcpTools,
  mintPersonalAccessToken,
} from '../utils/mcp';
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
 * FILM-1906, integration: the analytics tools over the real endpoint, with
 * a token minted through the same database function the settings page uses.
 *
 * Two parts. The team check runs everywhere: a token for team A asking for
 * team B's project is FORBIDDEN from the tools, and the catalogue the
 * client lists carries the spec's tools with their annotations. The figures
 * need the local ClickHouse (`./scripts/local-env.sh up`, a server started
 * with `deployment/config/local.env`), so that part is gated like the
 * experiments evidence: `CLICKHOUSE_EVIDENCE=1`.
 */

async function seedTeamWithProject(prefix: string) {
  const team = await seedTeamAccount({ emailPrefix: prefix });
  const connectionId = await seedYouTubeConnection(team.accountId);
  const project = await seedProject(team);
  const { seasonId } = await seedSeason(project.id);

  // The Overview reaches publishes through episodes → seasons → project
  // with inner joins, so an episode outside a season is invisible to it.
  const first = await seedPublishedEpisode(project.id, connectionId, {
    number: 1,
    seasonId,
    title: 'Hundred views',
  });
  const second = await seedPublishedEpisode(project.id, connectionId, {
    number: 2,
    seasonId,
    title: 'Two hundred and fifty views',
  });

  return {
    team,
    connectionId,
    projectId: project.id,
    publishIds: [first.publishId, second.publishId] as const,
    episodeIds: [first.episodeId, second.episodeId] as const,
  };
}

test.describe('MCP analytics tools', () => {
  test('a token for team A is refused team B’s project by every analytics read, and lists the catalogue', async () => {
    const a = await seedTeamWithProject('mcp-a');
    const b = await seedTeamWithProject('mcp-b');
    const token = await mintPersonalAccessToken(a.team, {
      name: 'analytics spec',
      scopes: ['studio:read'],
    });

    // The catalogue: the spec's tools, read-only, with their views.
    const tools = await listMcpTools(token);
    const names = tools.map((tool) => tool.name);

    for (const name of [
      'get_account_overview',
      'get_project_analytics',
      'get_deep_dive',
      'get_video_log',
      'get_revenue',
      'get_video_funnel',
      'get_ai_usage',
      'update_publish_note',
    ]) {
      expect(names, name).toContain(name);
    }

    const projectAnalytics = tools.find(
      (tool) => tool.name === 'get_project_analytics',
    );
    expect(projectAnalytics?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(
      (projectAnalytics?.inputSchema?.properties?.view as { enum?: string[] })
        ?.enum,
    ).toEqual(['overview', 'content', 'daily', 'audience']);

    // Own project: answered (figures null or empty without ClickHouse rows,
    // never an error), with the coverage note beside them.
    const own = await callMcpTool(token, 'get_project_analytics', {
      projectId: a.projectId,
      view: 'overview',
    });
    expect(own.isError).toBe(false);
    expect(own.structuredContent).toMatchObject({
      view: 'overview',
      data: { projectId: a.projectId },
      notes: { window: expect.any(Object) },
    });

    // Team B's project, episode and video: FORBIDDEN, in the error contract.
    for (const [name, args] of [
      ['get_project_analytics', { projectId: b.projectId, view: 'overview' }],
      ['get_deep_dive', { view: 'median', projectId: b.projectId }],
      ['get_video_log', { projectId: b.projectId }],
      ['get_retention_curve', { publishId: b.publishIds[0] }],
      ['get_data_coverage', { projectId: b.projectId }],
      [
        'get_video_funnel',
        { projectId: b.projectId, videoId: b.publishIds[0] },
      ],
      ['list_channels', { projectId: b.projectId }],
      ['get_saved_insights', { projectId: b.projectId }],
    ] as const) {
      const refused = await callMcpTool(token, name, { ...args });

      expect(refused.isError, name).toBe(true);
      expect(refused.structuredContent, name).toMatchObject({
        code: 'FORBIDDEN',
        retryable: false,
      });
    }

    // A read-only token cannot write.
    const write = await callMcpTool(token, 'update_publish_note', {
      publishId: a.publishIds[0],
      note: 'x',
      expectedUpdatedAt: null,
    });
    expect(write.isError).toBe(true);
    expect(write.structuredContent).toMatchObject({
      code: 'FORBIDDEN',
      details: { required_scope: 'studio:write' },
    });
  });

  /**
   * Two videos published today with 100 and 250 views on their first day.
   * Hand-computed: the Overview's total is 350, all of it YouTube (100%);
   * the Deep Dive's monthly median over the two is 175 (quantileExactInclusive
   * at 0.5 of {100, 250}), p25 137.5, p75 212.5, mean 175, over 2 videos.
   */
  test('reads seeded ClickHouse figures back through get_project_analytics and get_deep_dive', async () => {
    test.skip(
      !process.env.CLICKHOUSE_EVIDENCE,
      'Set CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
    );

    const a = await seedTeamWithProject('mcp-ch');
    const token = await mintPersonalAccessToken(a.team, {
      scopes: ['studio:read'],
    });

    const publishedAt = new Date();
    publishedAt.setUTCHours(0, 0, 0, 0);
    const videos: SeededVideo[] = a.publishIds.map((videoId, index) => ({
      videoId,
      projectId: a.projectId,
      accountId: a.team.accountId,
      connectionId: a.connectionId,
      title: index === 0 ? 'Hundred views' : 'Two hundred and fifty views',
      publishedAt,
    }));

    await seedVideoDims(videos);
    await seedVideoMetricsBatch([
      { video: videos[0]!, days: [{ ageDays: 0, views: 100 }] },
      { video: videos[1]!, days: [{ ageDays: 0, views: 250 }] },
    ]);

    const overview = await callMcpTool(token, 'get_project_analytics', {
      projectId: a.projectId,
      view: 'overview',
    });
    expect(overview.isError).toBe(false);

    const data = overview.structuredContent.data as {
      totalViews: number | null;
      contentCount: number;
      platformTotals: Array<{
        platform: string;
        views: number | null;
        percentage: number | null;
      }>;
    };
    const notes = overview.structuredContent.notes as {
      measured: boolean;
      reason: string | null;
    };

    expect(data.totalViews).toBe(350);
    expect(data.contentCount).toBe(2);
    expect(data.platformTotals).toEqual([
      expect.objectContaining({
        platform: 'youtube',
        views: 350,
        percentage: 100,
      }),
    ]);
    expect(notes).toMatchObject({ measured: true, reason: null });

    const median = await callMcpTool(token, 'get_deep_dive', {
      view: 'median',
      projectId: a.projectId,
      bucket: 'month',
    });
    expect(median.isError).toBe(false);

    const buckets = median.structuredContent.data as Array<{
      videoCount: number;
      medianViews: number;
      p25Views: number;
      p75Views: number;
      meanViews: number;
    }>;

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      videoCount: 2,
      medianViews: 175,
      p25Views: 137.5,
      p75Views: 212.5,
      meanViews: 175,
    });

    console.log(
      'MCP_FIGURES',
      JSON.stringify({
        totalViews: data.totalViews,
        platformTotals: data.platformTotals,
        median: buckets[0],
      }),
    );
  });

  /**
   * Criterion 7: usage rows read under their policy and split by the run's
   * mode through `llm_usage_analytics.run_id` (FILM-1903). Three rows are
   * written as the worker would: two with no run, one on an open
   * server-mode run (the table's trigger refuses a usage row on an external
   * run, so that is the only mode a row can carry). Cost is summed where
   * measured and null where no row measured it.
   */
  test('get_ai_usage splits the team’s usage by run mode through generation_runs', async () => {
    const a = await seedTeamWithProject('mcp-usage');
    const token = await mintPersonalAccessToken(a.team, {
      scopes: ['studio:read'],
    });
    const auth = serviceRoleAuth();

    const run = await insertRow<{ id: string }>(
      'generation_runs',
      {
        account_id: a.team.accountId,
        project_id: a.projectId,
        target_type: 'episode',
        target_id: a.episodeIds[0],
        stage: 'story',
        mode: 'server',
        created_by: a.team.userId,
      },
      auth,
    );

    const usage = (extra: Record<string, unknown>) => ({
      account_id: a.team.accountId,
      user_id: a.team.userId,
      llm_provider: 'google',
      llm_model: 'gemini-2.5-pro',
      template_slug: 'story-generation',
      status: 'success',
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
      ...extra,
    });

    await insertRow('llm_usage_analytics', usage({ total_cost: 0.02 }), auth);
    await insertRow('llm_usage_analytics', usage({ total_cost: null }), auth);
    await insertRow(
      'llm_usage_analytics',
      usage({ total_cost: 0.03, run_id: run.id }),
      auth,
    );

    const result = await callMcpTool(token, 'get_ai_usage', {});
    expect(result.isError).toBe(false);

    const content = result.structuredContent as {
      totals: { calls: number; totalTokens: number; totalCost: number | null };
      byMode: Array<{ key: string; calls: number; totalCost: number | null }>;
      notes: { byModeReason: string | null };
    };

    expect(content.totals).toMatchObject({ calls: 3, totalTokens: 4500 });
    expect(content.totals.totalCost).toBeCloseTo(0.05);
    expect(content.byMode).toEqual([
      expect.objectContaining({ key: 'unattributed', calls: 2 }),
      expect.objectContaining({ key: 'server', calls: 1, totalCost: 0.03 }),
    ]);
    expect(content.notes.byModeReason).toBeNull();

    console.log('MCP_AI_USAGE', JSON.stringify(content));
  });
});
