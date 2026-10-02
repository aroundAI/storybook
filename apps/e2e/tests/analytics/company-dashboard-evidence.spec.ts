import { Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import {
  clickHouseDate,
  daysAgo,
  deleteClickHouse,
  insertClickHouse,
} from '../utils/clickhouse';
import {
  SeededTeam,
  insertRow,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-162: the company dashboard (`/home/<team>`) read the account totals,
 * which turned the watch time and follower gain TikTok does not report into
 * 0, so an all-TikTok team read "Watch Time 0m". The cards say "Not
 * measured" for it, and a measured figure beside it is still a figure.
 *
 * Needs ClickHouse: skipped unless CLICKHOUSE_EVIDENCE is set, as the
 * 🧬 E2E evidence job sets it. Screenshots only with CAPTURE_EVIDENCE.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

const SERVICE_ROLE_KEY =
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

type Platform = 'tiktok' | 'youtube' | 'facebook';

interface Seeded {
  team: SeededTeam;
  projectId: string;
  projectSlug: string;
  /** Each platform's episode slug, for the episode's analytics page. */
  episodeSlugs: Partial<Record<Platform, string>>;
}

/**
 * A team with one published video per platform, each on its own channel.
 * A platform in `noRows` is published but has no rows yet (KB-166).
 */
async function seedTeam(
  page: Page,
  platforms: Platform[],
  { noRows = [] }: { noRows?: Platform[] } = {},
): Promise<Seeded> {
  const team = await seedTeamAccount({ emailPrefix: 'kb162' });
  const project = await seedProject(team);
  const rows: object[] = [];
  const episodeSlugs: Seeded['episodeSlugs'] = {};

  for (const [index, platform] of platforms.entries()) {
    const connection = await seedYouTubeConnection(
      team.accountId,
      `KB-162 ${platform}`,
      { platform },
    );
    const episode = await insertRow<{ id: string }>(
      'episodes',
      {
        project_id: project.id,
        number: index + 1,
        title: `${platform} cut`,
        // The episode routes resolve `[episodeSlug]` by slug.
        slug: `kb166-${platform}-${project.id.slice(0, 8)}`,
      },
      { key: SERVICE_ROLE_KEY },
    );
    episodeSlugs[platform] = `kb166-${platform}-${project.id.slice(0, 8)}`;
    const publish = await insertRow<{ id: string }>(
      'publishes',
      {
        episode_id: episode.id,
        platform_connection_id: connection,
        platform,
        status: 'published',
        title: `${platform} cut`,
        published_at: daysAgo(5).toISOString(),
      },
      { key: SERVICE_ROLE_KEY },
    );

    if (!noRows.includes(platform)) {
      rows.push(...metricRows(project.id, publish.id, platform));
    }
  }

  if (rows.length > 0) await insertClickHouse('video_metrics', rows);
  await signInAs(page, team);

  return {
    team,
    projectId: project.id,
    projectSlug: project.slug,
    episodeSlugs,
  };
}

/**
 * Two days inside the dashboard's 30-day window. TikTok: 100 + 80 views and
 * no watch time, follower gain or saves (NULL, as its sync writes them).
 * YouTube: 200 views, 600 seconds watched (10m), 4 followers gained.
 * Facebook: no views at all (NULL, KB-153), 7 likes on each of two days.
 */
function metricRows(projectId: string, videoId: string, platform: Platform) {
  const tiktok = platform === 'tiktok';
  const row = (
    date: Date,
    views: number | null,
    watch: number | null,
    subscribers: number | null,
    likes = 1,
  ) => ({
    project_id: projectId,
    video_id: videoId,
    platform,
    metric_date: clickHouseDate(date),
    views,
    likes,
    comments: 0,
    shares: 0,
    saves: null,
    watch_time_seconds: watch,
    revenue_cents: 0,
    subscribers_gained: subscribers,
    metric_source: platform === 'youtube' ? 'analytics_api' : 'snapshot_delta',
    extra_metrics: '{}',
  });

  if (platform === 'facebook') {
    return [
      row(daysAgo(2), null, null, null, 7),
      row(daysAgo(3), null, null, null, 7),
    ];
  }

  return tiktok
    ? [row(daysAgo(2), 100, null, null), row(daysAgo(3), 80, null, null)]
    : [row(daysAgo(2), 200, 600, 4)];
}

async function openDashboard(page: Page, team: SeededTeam) {
  await page.goto(`/home/${team.slug}`);
  await byTest(page, 'metric-card-views').waitFor();
}

function card(page: Page, key: string) {
  return byTest(page, `metric-card-${key}`);
}

async function shoot(page: Page, name: string, bug = 'kb162') {
  if (!process.env.CAPTURE_EVIDENCE) return;

  await page.mouse.move(0, 0);
  // The dashboard fades in; a shot taken mid-animation reads as disabled.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${bug}-${name}.png`, fullPage: true });
}

test.describe('Company dashboard: a figure no platform measured (KB-162)', () => {
  test.skip(
    !process.env.CLICKHOUSE_EVIDENCE,
    'Set CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.use({ viewport: { width: 1440, height: 1100 } });

  const seeded: Seeded[] = [];

  test.afterAll(async () => {
    for (const { projectId } of seeded) {
      await deleteClickHouse('video_metrics', `project_id = '${projectId}'`);
    }
  });

  test('an all-TikTok team: Watch Time and Subscribers say Not measured, never 0m or 0', async ({
    page,
  }) => {
    const fixture = await seedTeam(page, ['tiktok']);
    seeded.push(fixture);

    await openDashboard(page, fixture.team);

    for (const key of ['watchTime', 'subscribers']) {
      await expect(byTest(card(page, key), 'metric-not-measured')).toHaveText(
        'Not measured',
      );
      await expect(byTest(card(page, key), 'metric-value')).toHaveCount(0);
    }
    await expect(card(page, 'watchTime')).not.toContainText('0m');
    // What TikTok does measure is still a figure: 100 + 80.
    await expect(byTest(card(page, 'views'), 'metric-value')).toHaveText('180');

    await shoot(page, '1-tiktok-team');
  });

  test('a team with YouTube too: its measured watch time and follower gain are figures', async ({
    page,
  }) => {
    const fixture = await seedTeam(page, ['tiktok', 'youtube']);
    seeded.push(fixture);

    await openDashboard(page, fixture.team);

    // Only YouTube measured them: 600 seconds is 10m, and 4 followers.
    await expect(byTest(card(page, 'watchTime'), 'metric-value')).toHaveText(
      '10m',
    );
    await expect(byTest(card(page, 'subscribers'), 'metric-value')).toHaveText(
      '4',
    );
    // Revenue alone still reads Not measured: no platform supplies it
    // (FILM-1705).
    for (const key of ['watchTime', 'subscribers']) {
      await expect(byTest(card(page, key), 'metric-not-measured')).toHaveCount(
        0,
      );
    }
    await expect(
      byTest(card(page, 'revenue'), 'metric-not-measured'),
    ).toHaveText('Not measured');
    // 180 from TikTok and 200 from YouTube.
    await expect(byTest(card(page, 'views'), 'metric-value')).toHaveText('380');

    await shoot(page, '2-tiktok-and-youtube-team');
  });

  test('a Facebook-only team: Views say Not measured, never 0', async ({
    page,
  }) => {
    const fixture = await seedTeam(page, ['facebook']);
    seeded.push(fixture);

    await openDashboard(page, fixture.team);

    await expect(byTest(card(page, 'views'), 'metric-not-measured')).toHaveText(
      'Not measured',
    );
    await expect(byTest(card(page, 'views'), 'metric-value')).toHaveCount(0);
    // Facebook's likes are measured: 7 + 7.
    await expect(byTest(card(page, 'likes'), 'metric-value')).toHaveText('14');

    await shoot(page, '3-facebook-team');
  });

  /**
   * KB-166: a null Views total gave Facebook's reason whatever the scope.
   * The reason comes from the scope's platforms: the matrix's note for one
   * with no views column, the chip's no-data line for one with no rows.
   */
  const FACEBOOK_NOTE =
    'Facebook counts four different kinds of view, and none of them is a view in this sense, so its plays are not counted as views.';

  test('Facebook with rows and YouTube without: the Views reason names both, each for its own cause', async ({
    page,
  }) => {
    const fixture = await seedTeam(page, ['facebook', 'youtube'], {
      noRows: ['youtube'],
    });
    seeded.push(fixture);

    await openDashboard(page, fixture.team);

    const notMeasured = byTest(card(page, 'views'), 'metric-not-measured');
    await expect(notMeasured).toHaveText('Not measured');
    await expect(notMeasured).toHaveAttribute(
      'title',
      `YouTube: connected, but no data for the last 30 days. ${FACEBOOK_NOTE}`,
    );

    await shoot(page, '1-facebook-and-empty-youtube-team', 'kb166');
  });

  test('a YouTube-only episode with no rows yet: the Views reason is the no-data one, not Facebook’s', async ({
    page,
  }) => {
    const fixture = await seedTeam(page, ['youtube'], { noRows: ['youtube'] });
    seeded.push(fixture);

    await page.goto(
      `/home/${fixture.team.slug}/studio/${fixture.projectSlug}/episodes/${fixture.episodeSlugs.youtube}/analytics`,
    );

    const notMeasured = byTest(card(page, 'views'), 'metric-not-measured');
    await expect(notMeasured).toHaveText('Not measured', { timeout: 30_000 });
    await expect(notMeasured).toHaveAttribute(
      'title',
      'YouTube: connected, but no data for any day so far.',
    );
    await expect(notMeasured).not.toHaveAttribute('title', /Facebook/);

    await shoot(page, '2-youtube-episode-no-rows', 'kb166');
  });
});
