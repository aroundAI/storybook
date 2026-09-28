import { Page, expect, test } from '@playwright/test';

import {
  AudienceRow,
  SeededVideo,
  daysAgo,
  seedVideoAudience,
  seedVideoDims,
  seedVideoMetricsBatch,
} from '../utils/clickhouse';
import {
  SeededProject,
  SeededTeam,
  seedProject,
  seedPublishedEpisode,
  seedSeason,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * The Audience tab, with every figure on it traced to a ClickHouse row
 * (FILM-1701).
 *
 * The tab used to render three cards from constants typed into a source
 * file — "78% mobile", seven interests, a Friday-evening peak — in the same
 * treatment as the measured cards beside them. This seeds `video_audience`
 * with rows whose answer was computed by hand, reads the figures off the
 * page, and asserts the invented ones are gone.
 *
 * The rows are chosen so each plausible wrong implementation lands on a
 * different number than the right one:
 *
 *   | Figure          | Pooled by views | Mean of per-video shares | The old literal |
 *   |-----------------|-----------------|--------------------------|-----------------|
 *   | Mobile          | 37.5%           | 45.0%                    | 78%             |
 *   | Desktop         | 45.0%           | 40.0%                    | 18%             |
 *   | Tablet          | 15.0%           | 10.0%                    | 4%              |
 *   | TV              | 2.5%            | 5.0%                     | (not shown)     |
 *   | Male            | 30.0%           | 40.0%                    | 58%             |
 *   | United States   | 25.0%           | 40.0%                    | 42%             |
 *   | 18-24           | 20.0%           | 30.0%                    | 32.5%           |
 *
 * Needs a server reading the local ClickHouse, so it is gated like the other
 * evidence specs and runs in the 🧬 E2E evidence job.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

/** Every literal the three fabricated cards used to put on screen. */
const FABRICATED = [
  '78%',
  '18%',
  '4%',
  'Sci-Fi Movies',
  'Digital Art',
  'Friday, 6:00 PM',
  'Most active global time',
  '4.2%',
];

interface AudienceFixture {
  team: SeededTeam;
  project: SeededProject;
  first: SeededVideo;
  second: SeededVideo;
}

/**
 * A team, a project with a season, and two published YouTube videos with
 * 1,000 and 3,000 views inside the dashboard's default 30-day window.
 *
 * The views are the weights: a percentage-only row (age, gender) counts for
 * its share of the video's own views, so the two videos must differ or a
 * view-weighted pool and a plain mean would agree.
 */
async function setup(page: Page): Promise<AudienceFixture> {
  const team = await seedTeamAccount();
  const project = await seedProject(team);
  const { seasonId } = await seedSeason(project.id);
  const connectionId = await seedYouTubeConnection(team.accountId, 'Main');

  const publishes = await Promise.all(
    [1, 2].map((number) =>
      seedPublishedEpisode(project.id, connectionId, { number, seasonId }),
    ),
  );

  const [first, second] = publishes.map((publish, index) => ({
    videoId: publish.publishId,
    projectId: project.id,
    accountId: team.accountId,
    connectionId,
    title: `Seeded Episode ${index + 1}`,
    publishedAt: daysAgo(10),
  })) as [SeededVideo, SeededVideo];

  await seedVideoDims([first, second]);
  await seedVideoMetricsBatch([
    { video: first, days: [{ ageDays: 1, views: 1_000 }] },
    { video: second, days: [{ ageDays: 1, views: 3_000 }] },
  ]);

  await signInAs(page, team);

  return { team, project, first, second };
}

const DEMOGRAPHICS: [AudienceRow[], AudienceRow[]] = [
  [
    { dimension: 'age_group', key: 'age18-24', percentage: 50 },
    { dimension: 'age_group', key: 'age25-34', percentage: 50 },
    { dimension: 'gender', key: 'male', percentage: 60 },
    { dimension: 'gender', key: 'female', percentage: 40 },
    { dimension: 'country', key: 'US', views: 700 },
    { dimension: 'country', key: 'IN', views: 300 },
  ],
  [
    { dimension: 'age_group', key: 'age18-24', percentage: 10 },
    { dimension: 'age_group', key: 'age25-34', percentage: 90 },
    { dimension: 'gender', key: 'male', percentage: 20 },
    { dimension: 'gender', key: 'female', percentage: 80 },
    { dimension: 'country', key: 'US', views: 300 },
    { dimension: 'country', key: 'IN', views: 2_700 },
  ],
];

/** YouTube's own `deviceType` values, as `buildAudienceRows` writes them. */
const DEVICES: [AudienceRow[], AudienceRow[]] = [
  [
    { dimension: 'device', key: 'MOBILE', views: 600 },
    { dimension: 'device', key: 'DESKTOP', views: 300 },
    { dimension: 'device', key: 'TV', views: 100 },
  ],
  [
    { dimension: 'device', key: 'MOBILE', views: 900 },
    { dimension: 'device', key: 'DESKTOP', views: 1_500 },
    { dimension: 'device', key: 'TABLET', views: 600 },
  ],
];

async function openAnalytics(page: Page, fixture: AudienceFixture) {
  // The app scrolls inside its own container, so `fullPage` captures one
  // viewport. Tall enough to hold the whole tab instead.
  await page.setViewportSize({ width: 1280, height: 1900 });

  await page.goto(
    `/home/${fixture.team.slug}/studio/${fixture.project.slug}/analytics`,
  );
}

async function openAudience(page: Page) {
  await byTest(page, 'analytics-tab-audience').click();

  await expect(byTest(page, 'audience-grid')).toBeVisible();
}

test.describe('FILM-1701 — the Audience tab shows only what was measured', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE || !process.env.CLICKHOUSE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 and CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
  );

  test.describe.configure({ timeout: 180_000 });

  test('reads Device Type from video_audience, pooled by views', async ({
    page,
  }) => {
    const fixture = await setup(page);

    await seedVideoAudience([
      { video: fixture.first, rows: [...DEMOGRAPHICS[0], ...DEVICES[0]] },
      { video: fixture.second, rows: [...DEMOGRAPHICS[1], ...DEVICES[1]] },
    ]);

    await openAnalytics(page, fixture);
    await openAudience(page);

    const device = byTest(page, 'audience-card-device');
    const share = (key: string) =>
      device.locator(
        `[data-test="device-row-${key}"] [data-test="device-share"]`,
      );

    // 1,500 + 1,800 + 600 + 100 = 4,000 views carrying a device.
    await expect(share('DESKTOP')).toHaveText('45.0%');
    await expect(share('MOBILE')).toHaveText('37.5%');
    await expect(share('TABLET')).toHaveText('15.0%');
    await expect(share('TV')).toHaveText('2.5%');

    // A device nobody watched on has no row: it is not a 0% one.
    await expect(device.locator('[data-test^="device-row-"]')).toHaveCount(4);
    await expect(byTest(device, 'device-total-views')).toHaveText(
      /4,000 views/,
    );

    // The measured cards beside it, in the same unit.
    const audience = byTest(page, 'audience-grid');

    await expect(
      audience.locator(
        '[data-test="age-row-age18-24"] [data-test="age-share"]',
      ),
    ).toHaveText('20.0%');
    await expect(
      audience.locator(
        '[data-test="age-row-age25-34"] [data-test="age-share"]',
      ),
    ).toHaveText('80.0%');
    await expect(
      audience.locator(
        '[data-test="geography-row-IN"] [data-test="geography-share"]',
      ),
    ).toHaveText('75.0%');
    await expect(
      audience.locator(
        '[data-test="geography-row-US"] [data-test="geography-share"]',
      ),
    ).toHaveText('25.0%');
    await expect(byTest(audience, 'gender-share-female')).toHaveText('70.0%');
    await expect(byTest(audience, 'gender-share-male')).toHaveText('30.0%');

    // The two cards that were never measured say so, and show no figure.
    for (const card of ['interests', 'peak-activity']) {
      const notCollected = audience.locator(
        `[data-test="audience-card-${card}"] [data-test="audience-not-collected"]`,
      );

      await expect(notCollected).toContainText("We don't collect this");
    }

    const text = await audience.innerText();

    for (const literal of FABRICATED) {
      expect(
        text,
        `"${literal}" is a literal, not a measurement`,
      ).not.toContain(literal);
    }

    await page.screenshot({
      path: `${OUT}/01-audience-measured.png`,
      fullPage: true,
    });
  });

  test('says there is no device data, rather than a zero or a default', async ({
    page,
  }) => {
    const fixture = await setup(page);

    // Demographics only — what a TikTok or Instagram channel sends, since
    // neither reports a device breakdown.
    await seedVideoAudience([
      { video: fixture.first, rows: DEMOGRAPHICS[0] },
      { video: fixture.second, rows: DEMOGRAPHICS[1] },
    ]);

    await openAnalytics(page, fixture);
    await openAudience(page);

    const device = byTest(page, 'audience-card-device');

    await expect(byTest(device, 'device-empty')).toContainText(
      'No device data',
    );
    await expect(device.locator('[data-test^="device-row-"]')).toHaveCount(0);
    await expect(device).not.toContainText('%');

    // The cards that do have rows are unaffected by the one that does not.
    await expect(byTest(page, 'gender-share-female')).toHaveText('70.0%');

    await page.screenshot({
      path: `${OUT}/02-audience-no-device-rows.png`,
      fullPage: true,
    });
  });

  test('fills Top Regions and Gender on the first load of Overview', async ({
    page,
  }) => {
    const fixture = await setup(page);

    await seedVideoAudience([
      { video: fixture.first, rows: DEMOGRAPHICS[0] },
      { video: fixture.second, rows: DEMOGRAPHICS[1] },
    ]);

    // Overview is the landing tab. The Audience tab is never opened here:
    // the audience read used to be enabled only there, so these two cards
    // stayed empty until a visitor had been to another tab and come back.
    await openAnalytics(page, fixture);

    const regions = byTest(page, 'overview-top-regions');

    await expect(
      regions.locator('[data-test="region-row-IN"] [data-test="region-share"]'),
    ).toHaveText('75.0%');
    await expect(
      regions.locator('[data-test="region-row-US"] [data-test="region-share"]'),
    ).toHaveText('25.0%');

    const gender = byTest(page, 'overview-gender');

    await expect(byTest(gender, 'gender-male')).toHaveText('30.0%');
    await expect(byTest(gender, 'gender-female')).toHaveText('70.0%');

    // 4,000 views, and no claim about which platforms they came from: both
    // videos here are YouTube, so "across TikTok, YouTube, and Instagram"
    // was false of this very page.
    const views = byTest(page, 'overview-views');

    await expect(views).toContainText('4,000');
    await expect(views).not.toContainText(/TikTok|Insta|YT\b/);

    await page.screenshot({
      path: `${OUT}/03-overview-first-load.png`,
      fullPage: true,
    });
  });
});
