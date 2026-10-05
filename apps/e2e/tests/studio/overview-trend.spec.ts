import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import {
  seedProject,
  seedPublishedEpisode,
  seedSeason,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-193. The project overview's Performance Insights cards drew "+12%" on
 * Total Views, "+5%" on Content Published, "0%" on Avg. Engagement and a
 * rising sparkline on two of them, whatever the numbers were: nothing
 * measured a previous period. A figure we did not measure is not shown.
 *
 * Seeded through the API; ClickHouse is not needed. One published video
 * makes "Content Published" non-zero, which is what switched "+5%" on.
 * Set CAPTURE_EVIDENCE=1 for the screenshot.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('Project overview: no trend it did not measure (KB-193)', () => {
  test('the Performance Insights cards carry no percentage change and no trend line', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb193' });
    const project = await seedProject(team);
    const connectionId = await seedYouTubeConnection(team.accountId);
    const { seasonId } = await seedSeason(project.id);
    await seedPublishedEpisode(project.id, connectionId, {
      title: 'A published video',
      seasonId,
    });

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}`);

    const heading = page.getByRole('heading', {
      name: 'Performance Insights',
    });
    await expect(heading).toBeVisible();

    // The three cards sit in the grid after the heading's row.
    const cards = page
      .locator('div.grid')
      .filter({ hasText: 'Content Published' })
      .filter({ hasText: 'Total Views' })
      .last();
    await expect(cards).toBeVisible();

    if (process.env.CAPTURE_EVIDENCE) {
      mkdirSync(OUT, { recursive: true });
      await cards.screenshot({ path: `${OUT}/kb-193-performance-cards.png` });
    }

    const text = (await cards.innerText()).replace(/\s+/g, ' ');
    expect(text).not.toMatch(/[+-]\d+(\.\d+)?%/);
    expect(await cards.locator('svg[preserveAspectRatio="none"]').count()).toBe(
      0,
    );
  });

  test('a project with nothing measured says Not measured for engagement, not 0% (KB-194)', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb194' });
    const project = await seedProject(team);
    const connectionId = await seedYouTubeConnection(team.accountId);
    const { seasonId } = await seedSeason(project.id);
    await seedPublishedEpisode(project.id, connectionId, {
      title: 'A published video',
      seasonId,
    });

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}`);

    const engagement = byTest(page, 'overview-engagement-rate');
    await expect(engagement).toBeVisible();

    if (process.env.CAPTURE_EVIDENCE) {
      mkdirSync(OUT, { recursive: true });
      await engagement
        .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]')
        .screenshot({ path: `${OUT}/kb-194-engagement-card.png` });
    }

    await expect(engagement).toContainText('Not measured');
    await expect(engagement).not.toContainText('0%');
  });
});
