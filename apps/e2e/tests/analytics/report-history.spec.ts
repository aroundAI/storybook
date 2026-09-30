import { Page, expect, test } from '@playwright/test';

import {
  SeededVideo,
  daysAgo,
  seedVideoDim,
  seedVideoMetrics,
} from '../utils/clickhouse';
import {
  readRows,
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
  storageObjectExists,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * Report history (FILM-809). A generated report leaves a row the account can
 * list, download again through a new link, and delete with its file.
 *
 * A report needs figures, so this seeds ClickHouse and is gated like the
 * other data-backed specs.
 */
test.describe('FILM-809 - report history', () => {
  test.skip(
    !process.env.CLICKHOUSE_EVIDENCE,
    'Set CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.describe.configure({ timeout: 180_000 });

  async function setup(page: Page) {
    const team = await seedTeamAccount({ emailPrefix: 'reports' });
    const project = await seedProject(team);
    const connectionId = await seedYouTubeConnection(team.accountId);
    const { publishId } = await seedPublishedEpisode(project.id, connectionId, {
      title: 'Report video',
    });

    const video: SeededVideo = {
      videoId: publishId,
      projectId: project.id,
      accountId: team.accountId,
      connectionId,
      title: 'Report video',
      publishedAt: daysAgo(20),
    };

    await seedVideoDim(video);
    await seedVideoMetrics(
      video,
      Array.from({ length: 10 }, (_, ageDays) => ({
        ageDays,
        views: 100 + ageDays,
      })),
    );

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}/analytics`);
    await byTest(page, 'analytics-export').click();

    return team;
  }

  async function generateCsv(page: Page) {
    await page.locator('[data-test="export-format-csv"]:visible').click();
    await page.locator('[data-test="export-generate"]:visible').click();

    await expect(byTest(page, 'export-report-ready')).toBeVisible();
  }

  test('lists a generated report, and again after a second one, then deletes it', async ({
    page,
  }) => {
    const team = await setup(page);

    await byTest(page, 'report-history-tab').click();
    await expect(byTest(page, 'report-history-empty')).toBeVisible();

    await page.getByRole('tab', { name: 'Generate Report' }).click();
    await generateCsv(page);

    await byTest(page, 'report-history-tab').click();

    const rows = byTest(page, 'report-history-row');

    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(/csv/i);
    await expect(rows.first()).toContainText(/\d+ records/);

    // The second generation, where a state bug would show: the list must
    // pick up the new row without a reload, newest first.
    await page.getByRole('tab', { name: 'Generate Report' }).click();
    await generateCsv(page);
    await byTest(page, 'report-history-tab').click();

    await expect(rows).toHaveCount(2);

    const stored = await readRows<{ id: string; storage_path: string }>(
      'generated_reports',
      `account_id=eq.${team.accountId}&select=id,storage_path&order=created_at.desc`,
    );

    expect(stored).toHaveLength(2);

    const newest = stored[0]!;

    await expect(rows.first()).toHaveAttribute('data-report-id', newest.id);
    expect(await storageObjectExists('reports', newest.storage_path)).toBe(
      true,
    );

    const download = page.waitForEvent('download');

    await byTest(rows.first(), 'report-history-download').click();

    expect((await download).suggestedFilename()).toMatch(/\.csv$/);

    await byTest(rows.first(), 'report-history-delete').click();
    await byTest(page, 'report-history-confirm-delete').click();

    await expect(rows).toHaveCount(1);
    await expect(rows.first()).not.toHaveAttribute('data-report-id', newest.id);

    expect(await storageObjectExists('reports', newest.storage_path)).toBe(
      false,
    );
  });
});
