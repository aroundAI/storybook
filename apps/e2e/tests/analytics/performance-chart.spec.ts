import { Page, expect, test } from '@playwright/test';

import {
  SeededVideo,
  daysAgo,
  seedVideoDim,
  seedVideoMetrics,
} from '../utils/clickhouse';
import {
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * The Performance Over Time chart in a browser (FILM-807): it renders the
 * seeded figures, stays usable at three widths, and its PNG export is a real
 * PNG. No unit test can show any of the three.
 *
 * Needs ClickHouse for the daily figures, so it is gated like the other
 * data-backed specs. Screenshots need CAPTURE_EVIDENCE on top.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

const WIDTHS = [
  { name: 'mobile', width: 375, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

async function openChart(page: Page) {
  const team = await seedTeamAccount();
  const project = await seedProject(team);
  const connectionId = await seedYouTubeConnection(team.accountId);
  const { publishId } = await seedPublishedEpisode(project.id, connectionId, {
    title: 'Chart video',
  });

  const video: SeededVideo = {
    videoId: publishId,
    projectId: project.id,
    accountId: team.accountId,
    connectionId,
    title: 'Chart video',
    publishedAt: daysAgo(20),
  };

  await seedVideoDim(video);
  await seedVideoMetrics(
    video,
    Array.from({ length: 15 }, (_, ageDays) => ({
      ageDays,
      views: 100 + ageDays * 40,
    })),
  );

  await signInAs(page, team);
  await page.goto(`/home/${team.slug}/studio/${project.slug}/analytics`);

  const chart = byTest(page, 'performance-chart');

  await expect(chart).toBeVisible();
  await expect(chart.locator('.recharts-surface')).toBeVisible();

  return chart;
}

test.describe('FILM-807 - the performance chart', () => {
  test.skip(
    !process.env.CLICKHOUSE_EVIDENCE,
    'Set CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.describe.configure({ timeout: 180_000 });

  test('draws the seeded series, and redraws when the metric changes', async ({
    page,
  }) => {
    const chart = await openChart(page);

    await expect(chart.locator('.recharts-area-area')).toHaveCount(1);
    await expect(chart.locator('.recharts-area-curve')).toHaveCount(1);
    await expect(
      chart.locator('.recharts-xAxis .recharts-cartesian-axis-tick').first(),
    ).toBeVisible();

    await chart.getByRole('radio', { name: 'Line' }).click();

    await expect(chart.locator('.recharts-line-curve')).toHaveCount(1);
    await expect(chart.locator('.recharts-area-curve')).toHaveCount(0);
  });

  for (const viewport of WIDTHS) {
    test(`is usable at ${viewport.name} (${viewport.width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      const chart = await openChart(page);
      const surface = chart.locator('.recharts-surface');

      await expect(async () => {
        const box = await surface.boundingBox();

        expect(box?.width ?? 0).toBeGreaterThan(0);
        expect(box?.height ?? 0).toBeGreaterThan(0);
      }).toPass();

      const measured = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth);

      const box = (await chart.boundingBox())!;

      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

      await expect(byTest(page, 'performance-chart-export')).toBeVisible();

      if (process.env.CAPTURE_EVIDENCE) {
        await chart.screenshot({
          path: `${OUT}/performance-chart-${viewport.name}.png`,
        });
      }
    });
  }

  test('exports a valid PNG', async ({ page }) => {
    await openChart(page);

    const download = page.waitForEvent('download');

    await byTest(page, 'performance-chart-export').click();

    const file = await download;

    expect(file.suggestedFilename()).toMatch(
      /^analytics-\d{4}-\d{2}-\d{2}\.png$/,
    );

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];

    for await (const chunk of stream) chunks.push(Buffer.from(chunk));

    const bytes = Buffer.concat(chunks);

    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });
});
