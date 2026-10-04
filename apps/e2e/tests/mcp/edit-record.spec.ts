import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type Page, expect, test } from '@playwright/test';

import { mintPersonalAccessToken } from '../utils/mcp';
import { headerOnlyMp4 } from '../utils/mp4';
import {
  insertRow,
  readRows,
  seedEpisodeWithShot,
  seedMembership,
  seedProject,
  seedProjectMember,
  seedTeamAccount,
  seedUser,
  serviceRoleAuth,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { MCP_URL } from './oauth-client';

/**
 * FILM-2006: the Edit record page and the Edit style card, after a
 * delivery made over MCP in the same test. A scripted StorybookStudio (an
 * SDK client with a personal access token) opens a session, uploads a
 * 16:9 render that passed QA and a 9:16 one that failed it, and delivers
 * with an explain-why report whose style says 16 shots and a cold open.
 *
 * The /edit page then shows the report (versions, 1:30 against a 1:35
 * target, 4 AI and 1 hand change, the scene's change and its reason) and
 * both renders with QA badges and a working signed download. The episode
 * analytics page shows the Edit style card: 15 cuts over 90 s is 10 cuts a
 * minute, 90 / 16 = 5.625 s a shot, AI share 4 / 5 = 80%. With ClickHouse
 * on, the hourly sync writes the session to edit_sessions_fact.
 *
 * Then the episode is published and a teammate (a project member) opens it
 * in their Studio: the session records previousStatus = published, the
 * page shows the teammate and their device, and the project owner
 * force-closes it, which puts published back. Twice, so the second close
 * is proved as well as the first.
 *
 * Screenshots for the PR are written only when CAPTURE_EVIDENCE is set.
 */
const EVIDENCE = process.env.CAPTURE_EVIDENCE
  ? (process.env.EVIDENCE_DIR ?? 'evidence')
  : null;

async function capture(page: Page, name: string) {
  if (EVIDENCE) {
    await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: true });
  }
}

type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

const REPORT = {
  versions: [
    {
      id: 'v1',
      label: 'Rough cut',
      parentId: null,
      createdAt: '2026-10-04T10:00:00Z',
      origin: 'rough_cut',
    },
    {
      id: 'v2',
      label: 'Tighter, 90 seconds',
      parentId: 'v1',
      createdAt: '2026-10-04T10:05:00Z',
      origin: 'ai',
    },
  ],
  finalDuration: 90,
  aiOps: 4,
  userOps: 1,
  explain: {
    plan: 'Make it 90 seconds',
    targetDuration: 95,
    scenes: [
      {
        scene: 1,
        durationBefore: 18,
        durationAfter: 12,
        changes: [
          {
            action: 'trimmed',
            target: 'Shot 1.1',
            reason: 'Information already given by dialogue',
            before: 6,
            after: 3,
            by: 'ai',
          },
        ],
      },
    ],
  },
  style: { shotCount: 16, hookType: 'cold-open' },
};

const PASSED = { pass: true, issues: [] };
const FAILED = {
  pass: false,
  issues: [
    {
      type: 'caption_safe_area',
      severity: 0.6,
      timeRange: { start: 2, end: 4 },
      scene: 1,
      detail: 'Caption crosses the 9:16 safe area',
    },
  ],
};

/** edit_sessions_fact as ClickHouse returns it, when this run has one. */
async function factRow(sessionId: string) {
  const host = process.env.CLICKHOUSE_HOST!;
  const query = `SELECT final_duration, target_duration, ai_ops, user_ops, cut_count,
      avg_shot_length, cuts_per_minute, hook_type, ai_share, languages, presets
    FROM edit_sessions_fact FINAL WHERE session_id = '${sessionId}' FORMAT JSONEachRow`;
  const response = await fetch(
    `${host}/?database=${process.env.CLICKHOUSE_DB ?? 'default'}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${process.env.CLICKHOUSE_USER ?? 'default'}:${process.env.CLICKHOUSE_PASSWORD ?? ''}`,
        ).toString('base64')}`,
      },
      body: query,
    },
  );
  const text = await response.text();

  expect(response.ok, text).toBe(true);

  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test.describe('The Edit record after a delivery over MCP (FILM-2006)', () => {
  test('the page shows the report and renders; the analytics page shows the edit style; an admin force-closes the next session', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const team = await seedTeamAccount({ emailPrefix: 'film2006' });
    const project = await seedProject(team);
    const { episodeId, slug } = await seedEpisodeWithShot(project.id);
    await updateRows('episodes', `id=eq.${episodeId}`, {
      status: 'ready',
      target_duration_seconds: 120,
    });
    // "Open in Studio" shows only for a team that turned it on (FILM-2005)
    await insertRow(
      'account_ai_settings',
      { account_id: team.accountId, desktop_integration_enabled: true },
      serviceRoleAuth(),
    );

    const token = await mintPersonalAccessToken(team, {
      name: 'Studio on the e2e MacBook',
      scopes: ['studio:read', 'studio:write'],
    });
    const client = new Client({ name: 'StorybookStudio', version: '0.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const call = (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args }) as Promise<ToolResult>;

    const renders: Record<string, { id: string; bytes: number }> = {};
    let sessionId = '';

    try {
      const open = await call('open_edit_session', {
        episodeId,
        packageEtag: 'e2e@v1',
      });
      expect(open.isError, JSON.stringify(open)).toBeFalsy();
      sessionId = open.structuredContent!.sessionId as string;

      for (const [preset, aspect, width, height, qa] of [
        ['youtube_16x9', '16:9', 1920, 1080, PASSED],
        ['shorts_9x16', '9:16', 1080, 1920, FAILED],
      ] as const) {
        const file = headerOnlyMp4({ seconds: 12, width, height });
        const requested = await call('request_render_upload', {
          sessionId,
          preset,
          language: 'en',
          aspect,
          bytes: file.byteLength,
          contentType: 'video/mp4',
        });
        expect(requested.isError, JSON.stringify(requested)).toBeFalsy();
        const upload = requested.structuredContent as {
          renderId: string;
          uploadUrl: string;
          headers: Record<string, string>;
        };

        const put = await fetch(upload.uploadUrl, {
          method: 'PUT',
          headers: upload.headers,
          body: file,
        });
        expect(put.ok, await put.text()).toBe(true);

        const finalized = await call('finalize_render', {
          renderId: upload.renderId,
          durationSeconds: 12,
          qa,
        });
        expect(finalized.isError, JSON.stringify(finalized)).toBeFalsy();

        renders[preset] = { id: upload.renderId, bytes: file.byteLength };
      }

      // The episode version the delivery is checked against
      const [current] = await readRows<{ version: number }>(
        'episodes',
        `id=eq.${episodeId}&select=version`,
      );
      const delivered = await call('deliver_edit', {
        sessionId,
        episodeVersion: current!.version,
        renders: [
          { renderId: renders.youtube_16x9!.id, primary: true },
          { renderId: renders.shorts_9x16!.id },
        ],
        report: REPORT,
        qa: PASSED,
      });
      expect(delivered.isError, JSON.stringify(delivered)).toBeFalsy();
    } finally {
      await client.close();
    }

    // ---- the Edit record page ------------------------------------------
    await signInAs(page, team);
    const editPath = `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/edit`;
    await page.goto(editPath);

    await expect(byTest(page, 'edit-record-duration')).toContainText('1:30');
    // the report's target (95 s) wins over the episode's (120 s)
    await expect(byTest(page, 'edit-record-duration')).toContainText(
      'Target 1:35 · −0:05',
    );
    await expect(byTest(page, 'edit-record-versions-count')).toContainText('2');
    await expect(byTest(page, 'edit-record-ai-ops')).toContainText('4');
    await expect(byTest(page, 'edit-record-user-ops')).toContainText('1');
    await expect(byTest(page, 'edit-record-version')).toHaveCount(2);
    await expect(byTest(page, 'edit-record-version').nth(1)).toContainText(
      'Tighter, 90 seconds',
    );
    await expect(byTest(page, 'edit-record-change')).toContainText(
      'Information already given by dialogue',
    );

    const table = byTest(page, 'edit-record-renders');
    const wide = table.locator(
      `[data-test="edit-record-render"][data-render-id="${renders.youtube_16x9!.id}"]`,
    );
    const tall = table.locator(
      `[data-test="edit-record-render"][data-render-id="${renders.shorts_9x16!.id}"]`,
    );
    await expect(byTest(table, 'edit-record-render')).toHaveCount(2);
    await expect(byTest(wide, 'render-primary')).toBeVisible();
    await expect(byTest(wide, 'render-qa')).toHaveAttribute('data-qa', 'pass');
    await expect(byTest(tall, 'render-qa')).toHaveAttribute('data-qa', 'fail');
    await expect(byTest(tall, 'render-qa')).toContainText('1 issue');
    await expect(wide).toContainText('0:12');

    // The download is a signed URL that serves the file the Studio sent
    const href = await byTest(wide, 'render-download').getAttribute('href');
    expect(href).toBeTruthy();
    const download = await fetch(href!);
    expect(download.status).toBe(200);
    expect((await download.arrayBuffer()).byteLength).toBe(
      renders.youtube_16x9!.bytes,
    );

    // Re-open in Studio: the episode header's button (FILM-2005), on this page
    await expect(byTest(page, 'open-in-studio-button')).toHaveCount(1);
    await expect(byTest(page, 'open-in-studio-button')).toBeVisible();
    await expect(byTest(page, 'open-edit-session')).toHaveCount(0);
    await capture(page, 'film-2006-01-edit-record');
    if (EVIDENCE) {
      // the workspace scrolls inside its own pane, so the table gets a shot of its own
      await table.screenshot({ path: `${EVIDENCE}/film-2006-01b-renders.png` });
    }

    // ---- the Edit style card -------------------------------------------
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/analytics`,
    );
    const card = byTest(page, 'edit-style-card');
    await expect(card).toBeVisible();
    await expect(byTest(card, 'edit-style-cut-density-value')).toHaveText(
      '10 cuts/min',
    );
    await expect(byTest(card, 'edit-style-cut-density')).toContainText(
      '15 cuts in 1:30',
    );
    await expect(byTest(card, 'edit-style-shot-length-value')).toHaveText(
      '5.6 s',
    );
    await expect(byTest(card, 'edit-style-hook-value')).toHaveText('cold-open');
    await expect(byTest(card, 'edit-style-ai-share-value')).toHaveText('80%');
    await card.scrollIntoViewIfNeeded();
    await capture(page, 'film-2006-02-edit-style-card');

    // ---- the hourly rollup, when this run has ClickHouse ---------------
    if (process.env.CLICKHOUSE_ENABLED === 'true' && process.env.CRON_SECRET) {
      const sync = await page.request.post('/api/analytics/sync', {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      });
      expect(sync.ok(), await sync.text()).toBe(true);

      const rows = await factRow(sessionId);
      expect(rows).toEqual([
        {
          final_duration: 90,
          target_duration: 95,
          ai_ops: 4,
          user_ops: 1,
          cut_count: 15,
          avg_shot_length: 5.625,
          cuts_per_minute: 10,
          hook_type: 'cold-open',
          ai_share: 0.8,
          languages: ['en'],
          presets: ['shorts_9x16', 'youtube_16x9'],
        },
      ]);

      // a second run adds no row
      await page.request.post('/api/analytics/sync', {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      });
      expect(await factRow(sessionId)).toHaveLength(1);
    }

    // ---- published, re-opened by a teammate, force-closed ---------------
    await updateRows('episodes', `id=eq.${episodeId}`, {
      status: 'published',
    });

    const editor = await seedUser('film2006-editor');
    await seedMembership(editor.userId, team.accountId);
    await seedProjectMember(project.id, editor.userId, 'member');
    const editorToken = await mintPersonalAccessToken(
      { ...editor, accountId: team.accountId },
      {
        name: "Studio on the editor's laptop",
        scopes: ['studio:read', 'studio:write'],
      },
    );

    for (const round of [1, 2]) {
      const again = new Client({ name: 'StorybookStudio', version: '0.1.0' });
      await again.connect(
        new StreamableHTTPClientTransport(new URL(MCP_URL), {
          requestInit: { headers: { Authorization: `Bearer ${editorToken}` } },
        }),
      );
      const reopened = (await again.callTool({
        name: 'open_edit_session',
        arguments: { episodeId, packageEtag: `e2e@v${round + 1}` },
      })) as ToolResult;
      await again.close();

      expect(reopened.isError, JSON.stringify(reopened)).toBeFalsy();
      expect(reopened.structuredContent!.previousStatus).toBe('published');

      await page.goto(editPath);
      const open = byTest(page, 'open-edit-session');
      await expect(open).toBeVisible();
      // mcp_connections is readable by its own user only; the owner sees
      // the teammate's device through edit_session_device
      await expect(byTest(open, 'open-session-device')).toHaveText(
        "Studio on the editor's laptop",
      );
      await expect(byTest(open, 'open-session-since')).toBeVisible();
      if (round === 1) await capture(page, 'film-2006-03-open-session');

      await byTest(open, 'force-close-session').click();
      await byTest(page, 'force-close-session-confirm').click();

      // After the action: the session is gone from the page and the episode
      // is published again — the second round proves it repeats.
      await expect(byTest(page, 'open-edit-session')).toHaveCount(0);
      await expect
        .poll(async () => {
          const [row] = await readRows<{ status: string }>(
            'episodes',
            `id=eq.${episodeId}&select=status`,
          );
          return row?.status;
        })
        .toBe('published');

      const sessions = await readRows<{ status: string; close_reason: string }>(
        'edit_sessions',
        `episode_id=eq.${episodeId}&close_reason=eq.admin&select=status,close_reason`,
      );
      expect(sessions).toHaveLength(round);
    }

    await capture(page, 'film-2006-04-after-force-close');
  });
});
