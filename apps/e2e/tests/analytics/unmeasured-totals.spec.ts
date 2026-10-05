import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import {
  type SeededVideo,
  clickHouseDate,
  daysAgo,
  deleteClickHouse,
  insertClickHouse,
  seedVideoDims,
} from '../utils/clickhouse';
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
 * KB-192: with no metric rows, the analytics page's Likes, Comments and
 * Shares cards read 0 while Views beside them read "Not measured", and the
 * Overview tab's count cards read 0 or "Could not be read.". No row is not
 * "nobody liked it" (KB-149, KB-162), nor a failed read: every count card
 * says Not measured, and a row makes each a figure again.
 *
 * | video | platform | row (days ago: views / likes / comments / shares) |
 * |-------|----------|---------------------------------------------------|
 * | yt-1  | YouTube  | 5: 120 / 12 / 3 / 2                               |
 *
 * The no-rows test holds whether or not the server reads ClickHouse. The
 * rows test needs it: skipped unless CLICKHOUSE_EVIDENCE is set.
 * Screenshots only with CAPTURE_EVIDENCE.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const OBSERVED = Boolean(process.env.CLICKHOUSE_EVIDENCE);
const SLOW = { timeout: 60_000 };

const COUNT_CARDS = ['views', 'likes', 'comments', 'shares'] as const;

/** The Overview tab's count cards, which said "Could not be read." for null. */
const OVERVIEW_CARDS = COUNT_CARDS.map((key) => `overview-${key}`);

async function seedPage(page: Page, { withRows }: { withRows: boolean }) {
  const team = await seedTeamAccount({ emailPrefix: 'kb192' });
  const project = await seedProject(team);
  const { seasonId } = await seedSeason(project.id);
  const connectionId = await seedYouTubeConnection(
    team.accountId,
    'KB-192 Studio',
  );
  const { publishId } = await seedPublishedEpisode(project.id, connectionId, {
    number: 1,
    seasonId,
    title: 'yt-1',
    platform: 'youtube',
  });

  if (withRows) {
    const video: SeededVideo = {
      videoId: publishId,
      projectId: project.id,
      accountId: team.accountId,
      connectionId,
      title: 'yt-1',
      publishedAt: daysAgo(10),
      platform: 'youtube',
    };

    await seedVideoDims([video]);
    await insertClickHouse('video_metrics', [
      {
        project_id: project.id,
        video_id: publishId,
        platform: 'youtube',
        metric_date: clickHouseDate(daysAgo(5)),
        views: 120,
        likes: 12,
        comments: 3,
        shares: 2,
        saves: 0,
        watch_time_seconds: 7200,
        revenue_cents: 0,
        subscribers_gained: 0,
        metric_source: 'analytics_api',
      },
    ]);
  }

  await signInAs(page, team);
  await page.goto(`/home/${team.slug}/studio/${project.slug}/analytics`);
  await expect(byTest(page, 'metric-card-views')).toBeVisible(SLOW);

  return { projectId: project.id };
}

const card = (page: Page, key: string) => byTest(page, `metric-card-${key}`);

async function shoot(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await card(page, 'views')
    .locator('xpath=../..')
    .screenshot({ path: `${OUT}/kb192-${name}-cards.png` });
  await byTest(page, 'overview-views')
    .locator('xpath=..')
    .screenshot({ path: `${OUT}/kb192-${name}-overview.png` });
}

test.describe('KB-192 — an unmeasured count is Not measured, never 0', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  const seeded: string[] = [];

  test.afterAll(async () => {
    if (!OBSERVED) return;

    for (const projectId of seeded) {
      await deleteClickHouse('video_metrics', `project_id = '${projectId}'`);
    }
  });

  test('no rows: Views, Likes, Comments and Shares all say Not measured', async ({
    page,
  }) => {
    await seedPage(page, { withRows: false });

    for (const key of COUNT_CARDS) {
      await expect(byTest(card(page, key), 'metric-not-measured')).toHaveText(
        'Not measured',
      );
      await expect(byTest(card(page, key), 'metric-value')).toHaveCount(0);
    }

    for (const key of OVERVIEW_CARDS) {
      await expect(byTest(byTest(page, key), 'card-no-figure')).toHaveText(
        'Not measured.',
      );
      await expect(byTest(byTest(page, key), 'card-figure')).toHaveCount(0);
    }

    await shoot(page, 'no-rows');
  });

  test('a row: each count is the figure it measured', async ({ page }) => {
    test.skip(!OBSERVED, 'needs a server that reads ClickHouse');

    const { projectId } = await seedPage(page, { withRows: true });
    seeded.push(projectId);

    const expected = { views: '120', likes: '12', comments: '3', shares: '2' };

    for (const key of COUNT_CARDS) {
      await expect(byTest(card(page, key), 'metric-value')).toHaveText(
        expected[key],
      );
      await expect(byTest(card(page, key), 'metric-not-measured')).toHaveCount(
        0,
      );
      await expect(
        byTest(byTest(page, `overview-${key}`), 'card-figure'),
      ).toHaveText(expected[key]);
    }

    await shoot(page, 'with-rows');
  });
});
