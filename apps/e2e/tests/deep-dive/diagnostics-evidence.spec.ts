import { expect, test } from '@playwright/test';

import {
  type SeededVideo,
  daysAgo,
  seedRetentionCurve,
  seedVideoDim,
  seedVideoMetrics,
  seedVideoReach,
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
 * Weekly diagnostics and the retention curve, with real figures
 * (FILM-1616).
 *
 * `diagnostics.spec.ts` holds the guards that need no data — including the
 * ownership check, which is Postgres-only and therefore the half that runs
 * in CI. This one seeds ClickHouse, so it can show the thing the table
 * exists for: a video whose packaging failed, and a curve with the cliff
 * that says its intro did.
 *
 * Needs the ClickHouse container, so it is gated like the other evidence
 * specs and cannot run in CI.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('FILM-1616 — diagnostics with data', () => {
  test.skip(
    !process.env.CLICKHOUSE_EVIDENCE,
    'Set CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.describe.configure({ timeout: 180_000 });

  test('flags the packaging, and the drill-down shows the cliff', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connection = await seedYouTubeConnection(team.accountId, 'Channel');

    const published = daysAgo(2);

    const healthy = await seedPublishedEpisode(project.id, connection, {
      number: 1,
      title: 'Packaging worked',
    });
    const failing = await seedPublishedEpisode(project.id, connection, {
      number: 2,
      title: 'Packaging failed',
    });

    const video = (videoId: string, title: string): SeededVideo => ({
      videoId,
      projectId: project.id,
      accountId: team.accountId,
      connectionId: connection,
      title,
      publishedAt: published,
    });

    // One video whose packaging worked, one whose did not. 8% against 1.2%
    // straddles the 3% threshold the table flags at, so the two rows differ
    // in the way the column exists to show.
    const healthyVideo = video(healthy.publishId, 'Packaging worked');
    await seedVideoDim(healthyVideo);
    await seedVideoMetrics(healthyVideo, [{ ageDays: 1, views: 800 }]);
    await seedVideoReach(healthyVideo, [
      { ageDays: 1, impressions: 10_000, ctr: 0.08 },
    ]);

    const failingVideo = video(failing.publishId, 'Packaging failed');
    await seedVideoDim(failingVideo);
    await seedVideoMetrics(failingVideo, [{ ageDays: 1, views: 120 }]);
    await seedVideoReach(failingVideo, [
      { ageDays: 1, impressions: 10_000, ctr: 0.012 },
    ]);

    // A curve that holds, then falls off a cliff at 15% through — inside
    // `detectRetentionCliff`'s early window, and well past its 0.15 drop.
    await seedRetentionCurve(failingVideo, [
      { elapsedRatio: 0, audienceWatchRatio: 1 },
      { elapsedRatio: 0.05, audienceWatchRatio: 0.95 },
      { elapsedRatio: 0.1, audienceWatchRatio: 0.9 },
      { elapsedRatio: 0.15, audienceWatchRatio: 0.45 },
      { elapsedRatio: 0.5, audienceWatchRatio: 0.35 },
      { elapsedRatio: 1, audienceWatchRatio: 0.2 },
    ]);

    await signInAs(page, team);

    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/analytics?tab=deep-dive`,
    );

    await byTest(page, 'analytics-tab-deep-dive').click();

    const rows = byTest(page, 'diagnostic-row');

    await expect(rows).toHaveCount(2);

    // Read the claims out of the DOM rather than eyeballing the screenshot:
    // an image cannot be checked by a reviewer, a table of values can.
    const measured = await rows.allInnerTexts();

    // eslint-disable-next-line no-console
    console.log('MEASURED_DIAGNOSTICS', JSON.stringify(measured, null, 2));

    expect(measured.join(' ')).toContain('1.2%');
    expect(measured.join(' ')).toContain('8.0%');

    // The section, not the page: it sits well below the fold, and a page
    // capture shows the strategy cards above it rather than the table this
    // is evidence for.
    await page
      .locator('[data-test="weekly-diagnostics-section"]')
      .screenshot({ path: `${OUT}/01-weekly-diagnostics.png` });

    // The drill-down: the row with the cliff opens the curve that shows it.
    await rows.filter({ hasText: 'Packaging failed' }).first().click();

    await expect(byTest(page, 'retention-drilldown')).toBeVisible();

    await expect(byTest(page, 'retention-curve-error')).toHaveCount(0);

    // Wait for the drawn curve, not just the panel. The first version of
    // this screenshot caught the loading skeleton — evidence of a spinner,
    // not of a cliff.
    await expect(
      page.getByRole('img', { name: 'Audience retention curve' }),
    ).toBeVisible();

    // The seeded curve drops 0.90 → 0.45 at 15% through: a 45-point drop,
    // stated in the caption rather than left to the eye.
    const caption = page.locator('[data-test="retention-drilldown"] p');

    await expect(caption).toContainText('Sharp drop of 45 points');

    // eslint-disable-next-line no-console
    console.log('MEASURED_CLIFF', await caption.innerText());

    await page
      .locator('[data-test="weekly-diagnostics-section"]')
      .screenshot({ path: `${OUT}/02-retention-cliff.png` });
  });

  test('opens the drill-down from the keyboard', async ({ page }) => {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connection = await seedYouTubeConnection(team.accountId, 'Channel');

    const video = await seedPublishedEpisode(project.id, connection, {
      number: 1,
      title: 'Keyboard reachable',
    });

    const seeded: SeededVideo = {
      videoId: video.publishId,
      projectId: project.id,
      accountId: team.accountId,
      connectionId: connection,
      title: 'Keyboard reachable',
      publishedAt: daysAgo(2),
    };

    await seedVideoDim(seeded);
    await seedVideoMetrics(seeded, [{ ageDays: 1, views: 300 }]);

    await signInAs(page, team);

    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/analytics?tab=deep-dive`,
    );

    await byTest(page, 'analytics-tab-deep-dive').click();

    const row = byTest(page, 'diagnostic-row').first();

    await expect(row).toBeVisible();

    // The row stays a row. `role="button"` on the <tr> left the body as
    // rowgroup → button → cell, so the cells were no longer owned by a row
    // and the numbers this table exists to convey fell out of the table's
    // reading model. The header row kept its cells, which is what made the
    // contrast visible in an accessibility snapshot.
    // Asserted through the accessibility tree, not a DOM attribute: a <tr>
    // has the implicit role `row` and carries no `role` attribute, so the
    // only way to see the break is to ask for roles. With `role="button"`
    // on the <tr> this section held one row — the header — and the data
    // row was a button owning cells.
    const section = byTest(page, 'weekly-diagnostics-section');

    await expect(section.getByRole('row')).toHaveCount(2);
    await expect(row.getByRole('cell')).not.toHaveCount(0);

    // The control is a real button in a cell, named for what it opens, and
    // it reports the panel's state.
    const open = byTest(row, 'diagnostic-open');

    await expect(open).toHaveAttribute('aria-expanded', 'false');

    // Reached and activated from the keyboard, which a <tr> with an
    // onClick never could be.
    await open.focus();
    await page.keyboard.press('Enter');

    await expect(byTest(page, 'retention-drilldown')).toBeVisible();

    await expect(open).toHaveAttribute('aria-expanded', 'true');
  });

  test('a video with no curve renders empty, never a flat zero', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connection = await seedYouTubeConnection(team.accountId, 'Channel');

    const video = await seedPublishedEpisode(project.id, connection, {
      number: 1,
    });

    const seeded: SeededVideo = {
      videoId: video.publishId,
      projectId: project.id,
      accountId: team.accountId,
      connectionId: connection,
      title: 'No retention rows',
      publishedAt: daysAgo(2),
    };

    // Metrics but no retention curve — the state every non-YouTube publish
    // is in, and the one where a zero-filled curve would read as a video
    // nobody watched.
    await seedVideoDim(seeded);
    await seedVideoMetrics(seeded, [{ ageDays: 1, views: 500 }]);

    await signInAs(page, team);

    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/analytics?tab=deep-dive`,
    );

    await byTest(page, 'analytics-tab-deep-dive').click();
    await byTest(page, 'diagnostic-row').first().click();

    await expect(byTest(page, 'retention-drilldown')).toBeVisible();

    // No cliff claimed, and no failure reported: absent data is absent.
    await expect(byTest(page, 'retention-curve-error')).toHaveCount(0);

    await expect(byTest(page, 'retention-drilldown')).toContainText(
      'No retention curve available',
    );

    // And no curve drawn — a zero-filled one would render as a video
    // nobody watched.
    await expect(
      page.getByRole('img', { name: 'Audience retention curve' }),
    ).toHaveCount(0);

    await page
      .locator('[data-test="weekly-diagnostics-section"]')
      .screenshot({ path: `${OUT}/03-no-retention.png` });
  });
});
