import { Page, expect, test } from '@playwright/test';

import { readRows, seedExperiment, seedPublishedVideos } from '../utils/seed';
import { byTest } from '../utils/visible';
import { ExperimentsPageObject } from './experiments.po';

/** PR screenshots, only when asked for (`CAPTURE_EVIDENCE=1`). */
async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  await page.screenshot({
    path: `${process.env.EVIDENCE_DIR ?? 'evidence'}/${name}.png`,
    fullPage: true,
  });
}

/**
 * FILM-1610 review, round 5. Each test here was written to reproduce a
 * finding and failed before its fix, on a production build.
 */

test.describe('Change log: what it can and cannot measure (round 5, A, H1, H2)', () => {
  test('a change baked into the video says before/after cannot measure it', async ({
    page,
  }) => {
    const log = new ExperimentsPageObject(page);
    await log.setup();

    const note = byTest(log.form(), 'experiment-category-note');

    await log.choose('experiment-category', 'experiment-category-option-hook');
    await expect(note).toContainText('part of the video itself');
    await capture(page, '30-baked-in-category-note');

    // A thumbnail or title is changed on the published video itself, so
    // before/after on the same videos measures it: no warning.
    await log.choose(
      'experiment-category',
      'experiment-category-option-packaging',
    );
    await expect(note).toHaveCount(0);
  });

  test('views at 30 days explains what it can show', async ({ page }) => {
    const log = new ExperimentsPageObject(page);
    await log.setup();

    await log.choose(
      'experiment-metric',
      'experiment-metric-option-views_at_30d',
    );
    await expect(byTest(log.form(), 'experiment-metric-note')).toContainText(
      'same before and after',
    );
  });

  test.describe('in UTC', () => {
    // Pinned: the start is the browser's local day, and the rule compares
    // with the UTC day ClickHouse keys metrics by. East of UTC, between
    // local and UTC midnight, "published now" is still inside yesterday's
    // window in UTC, and the right answer is then "no data". CI runs in UTC;
    // a local run in India failed on exactly that boundary.
    test.use({ timezoneId: 'UTC' });

    test('a baseline for videos published after its window says so, not "no data"', async ({
      page,
    }) => {
      const log = new ExperimentsPageObject(page);
      const team = await log.setup();

      const [fresh] = await seedPublishedVideos(
        team.projectId,
        team.connectionId,
        ['Published today'],
        new Date().toISOString(),
      );
      await log.goTo(team.slug);

      await log.field('experiment-title').fill('Fresh thumbnail');
      await log.field('experiment-change').fill('New thumbnail');
      await log.choose('experiment-metric', 'experiment-metric-option-ctr');
      await log.linkVideo(fresh!);
      await log.submitAndWaitForReset();

      const [row] = await readRows<{ id: string }>(
        'analytics_experiments',
        `select=id&account_id=eq.${team.accountId}`,
      );
      await page
        .locator(`[data-test="experiment-row-${row!.id}"]:visible`)
        .click();
      await page.getByRole('button', { name: 'Start', exact: true }).click();

      await expect(
        byTest(page, 'experiment-watched-baseline-unmeasured'),
      ).toHaveAttribute('data-reason', 'published_after_window');
      await capture(page, '31-published-after-window');
    });
  });
});

test.describe('Change log: the picker and dates (round 5, H4 H5 H6)', () => {
  test('each video says whether it is linked, to assistive technology too', async ({
    page,
  }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const [first, second] = team.publishIds;

    await log.linkVideo(first);
    await log.field('video-picker-trigger').click();

    await expect(
      byTest(page, `video-picker-option-${first}`),
    ).toHaveAccessibleName(/^Linked\b/);
    await expect(
      byTest(page, `video-picker-option-${second}`),
    ).toHaveAccessibleName(/^Not linked\b/);
  });

  test('the video list is as wide as the field that opens it', async ({
    page,
  }) => {
    const log = new ExperimentsPageObject(page);
    await log.setup();

    const trigger = log.field('video-picker-trigger');
    await trigger.click();

    const list = page.locator('[cmdk-root]');
    await expect(list).toBeVisible();

    // Polled: the popover opens with a zoom from 95%, so a single reading
    // mid-animation is 5% narrow. Before the fix it stayed ~1,000px wider.
    await expect
      .poll(async () => {
        const [triggerBox, listBox] = await Promise.all([
          trigger.boundingBox(),
          list.boundingBox(),
        ]);
        return Math.abs(listBox!.width - triggerBox!.width);
      })
      .toBeLessThanOrEqual(2);
    // Captured once the width has settled: the popover's open animation is
    // over, so the picture is the list as a user sees it.
    await capture(page, '32-picker-width');
  });

  test.describe("dates are the user's calendar days", () => {
    // 20:00 UTC on 1 January is 01:30 on 2 January in Kolkata.
    test.use({ timezoneId: 'Asia/Kolkata' });

    test('a video and a change dated after local midnight show the local day', async ({
      page,
    }) => {
      const log = new ExperimentsPageObject(page);
      const team = await log.setup();

      const [late] = await seedPublishedVideos(
        team.projectId,
        team.connectionId,
        ['Late-evening upload'],
        '2026-01-01T20:00:00Z',
      );
      const id = await seedExperiment(team.accountId, {
        title: 'Logged late',
        createdAt: '2026-01-01T20:00:00Z',
      });
      await log.goTo(team.slug);

      await expect(byTest(page, `experiment-row-${id}`)).toContainText(
        'Created 2026-01-02',
      );

      await log.field('video-picker-trigger').click();
      await expect(byTest(page, `video-picker-option-${late}`)).toContainText(
        '2026-01-02',
      );
      await capture(page, '33-local-dates-kolkata');
    });
  });
});

test.describe('Change log: signed out mid-session (round 5, H11)', () => {
  test('a start after the session ended goes to sign-in and changes nothing', async ({
    page,
    context,
  }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const id = await seedExperiment(team.accountId, { title: 'Signed out' });
    await log.goTo(team.slug);

    await byTest(page, `experiment-row-${id}`).click();
    await context.clearCookies();
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    await expect(page).toHaveURL(/\/auth\/sign-in/);

    const [row] = await readRows<{ status: string }>(
      'analytics_experiments',
      `select=status&id=eq.${id}`,
    );
    expect(row!.status).toBe('planned');
  });

  // KB-159. Reading the change back after the redirect queued more actions
  // in front of the navigation, each redirected again, and on a slow server
  // the sign-in page never arrived. Counted, not timed: the Start is the
  // only action the page may send.
  test('a start after the session ended sends no other action before sign-in', async ({
    page,
    context,
  }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const id = await seedExperiment(team.accountId, { title: 'Signed out' });
    await log.goTo(team.slug);

    await byTest(page, `experiment-row-${id}`).click();
    await expect(
      page.getByRole('button', { name: 'Start', exact: true }),
    ).toBeEnabled();
    await context.clearCookies();

    const actions: string[] = [];
    page.on('request', (request) => {
      if (request.headers()['next-action']) actions.push(request.url());
    });
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    await expect(page).toHaveURL(/\/auth\/sign-in/);
    expect(actions).toHaveLength(1);
  });
});
