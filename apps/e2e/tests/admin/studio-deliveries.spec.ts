import { type Page, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import {
  insertRow,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
} from '../utils/seed';
import { SUPER_ADMIN_STORAGE_STATE } from '../utils/super-admin';
import { byTest } from '../utils/visible';

/**
 * FILM-2006: the StorybookStudio deliveries panel on the super admin's MCP
 * page. It counts across every team, so the spec reads the counters, seeds
 * rows whose effect it knows, and asserts the deltas:
 *
 *   get_edit_package  +2  (two ok calls)
 *   deliver_edit      +2  (one ok, one TARGET_CHANGED)
 *   TARGET_CHANGED    +1
 *   uploading > 24 h  +1  (a render created 25 hours ago, still uploading)
 *
 * Then the hourly cron's sweep fails that render: it leaves "uploading"
 * and is counted as an expired upload instead.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/film-2006-${name}.png`, fullPage: true });
}

const COUNTERS = [
  'get-edit-package',
  'deliver-edit',
  'target-changed',
  'uploading-stale',
  'expired-uploads',
] as const;

async function counters(page: Page) {
  await expect(byTest(page, 'mcp-panel-studio')).toBeVisible();

  const values: Record<string, number> = {};

  for (const counter of COUNTERS) {
    values[counter] = Number(
      await byTest(page, `mcp-studio-${counter}`).locator('dd').innerText(),
    );
  }

  return values;
}

test.describe('the StorybookStudio deliveries panel', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('counts packages, deliveries, TARGET_CHANGED refusals and stale uploads, before and after the sweep', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'studio-panel' });
    const project = await seedProject(team);
    const { episodeId } = await seedEpisodeWithShot(project.id);

    await page.goto('/admin/mcp?days=7');
    const before = await counters(page);

    for (const [tool, status, code] of [
      ['get_edit_package', 'ok', null],
      ['get_edit_package', 'ok', null],
      ['deliver_edit', 'ok', null],
      ['deliver_edit', 'error', 'TARGET_CHANGED'],
    ] as const) {
      await insertRow(
        'mcp_tool_calls',
        {
          account_id: team.accountId,
          user_id: team.userId,
          tool,
          status,
          error_code: code,
          duration_ms: 25,
        },
        serviceRoleAuth(),
      );
    }

    const renderId = randomUUID();
    await insertRow(
      'episode_renders',
      {
        id: renderId,
        episode_id: episodeId,
        preset: 'youtube_16x9',
        aspect: '16:9',
        file_path: `projects/${project.id}/episodes/${episodeId}/renders/${renderId}.mp4`,
        status: 'uploading',
        created_at: new Date(Date.now() - 25 * 3_600_000).toISOString(),
      },
      serviceRoleAuth(),
    );

    await page.reload();

    await expect
      .poll(async () => (await counters(page))['get-edit-package'])
      .toBe(before['get-edit-package']! + 2);
    expect(await counters(page)).toEqual({
      'get-edit-package': before['get-edit-package']! + 2,
      'deliver-edit': before['deliver-edit']! + 2,
      'target-changed': before['target-changed']! + 1,
      'uploading-stale': before['uploading-stale']! + 1,
      'expired-uploads': before['expired-uploads']!,
    });
    await expect(byTest(page, 'mcp-panel-studio-status')).toHaveText(
      'Needs a look',
    );
    await byTest(page, 'mcp-panel-studio').scrollIntoViewIfNeeded();
    await capture(page, '05-admin-studio-panel');

    // The hourly cron's sweep fails the render; it moves column
    test.skip(!process.env.CRON_SECRET, 'the sweep needs CRON_SECRET');

    const sweep = await page.request.get('/api/cron/expire-generation-runs', {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    expect(sweep.ok(), await sweep.text()).toBe(true);

    await page.reload();
    const after = await counters(page);

    expect(after['uploading-stale']).toBe(before['uploading-stale']);
    expect(after['expired-uploads']).toBe(before['expired-uploads']! + 1);
  });
});
