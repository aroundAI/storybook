import { expect, test } from '@playwright/test';

import {
  SeededVideo,
  daysAgo,
  deleteClickHouse,
  seedVideoDim,
  seedVideoDims,
  seedVideoMetrics,
  seedVideoMetricsBatch,
  seedVideoReach,
} from '../utils/clickhouse';
import { seedMembership, seedRevenueRecord, seedUser } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { VideoLogFixture, VideoLogPageObject } from './video-log.po';

/**
 * The Video Log with figures in it (FILM-1615).
 *
 * `video-log.spec.ts` holds the guards that need no data. This spec seeds
 * ClickHouse, so it can assert the thing the table exists for: that a cell
 * is a number only when the number is a measurement, and says which reason
 * it is not when it is not.
 *
 * It also produces the PR screenshots, which is why the assertions read
 * their claims out of the DOM — an image cannot be checked by a reviewer,
 * and a table of measured values can.
 *
 * Needs the ClickHouse container, so it is gated like the other evidence
 * specs and runs in the 🧬 E2E job.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('FILM-1615 — the Video Log with data', () => {
  test.skip(
    !process.env.CLICKHOUSE_EVIDENCE,
    'Set CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.describe.configure({ timeout: 180_000 });

  test('shows a measurement as a number and everything else as its reason', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    const videos = await seedCellStates(fixture);

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();

    await expect(videoLog.rows()).toHaveCount(videos.length);

    const cellOf = (title: string, testIds: string[]) =>
      page
        .locator('[data-test="video-log-row"]', { hasText: title })
        .locator(testIds.map((id) => `[data-test="${id}"]`).join(', '))
        .first();

    // (a) a measured figure, exact — 1,000 in the first 30 days.
    await expect(cellOf('Measured', ['checkpoint-figure'])).toHaveText('1,000');

    // (b) a real zero: metrics exist and record no views. This is the case
    //     every other state must be distinguishable from, because rendering
    //     any of them as 0 would be a measurement the data does not support.
    await expect(cellOf('Real zero', ['checkpoint-figure'])).toHaveText('0');

    // (c) too young for the window to have closed.
    const immature = cellOf('Too young', ['checkpoint-immature']);

    await expect(immature).toHaveText(/^in \d+ days?$/);
    await expect(immature).toHaveAttribute(
      'aria-label',
      /Views in its first 30 days are known in/,
    );

    // (d) the window closed before analytics began: unrecoverable, not zero.
    const predates = cellOf('Late analytics', ['checkpoint-predates']);

    await expect(predates).toHaveText('n/a');
    await expect(predates).toHaveAttribute(
      'aria-label',
      /Analytics for this channel began 40 days after this video was published/,
    );

    // (e) nothing ingested at all.
    await expect(cellOf('No analytics', ['checkpoint-no-data'])).toHaveText(
      '—',
    );

    // (f) a row whose first days were missed, flagged for the whole row.
    await expect(
      page
        .locator('[data-test="video-log-row"]', { hasText: 'Late analytics' })
        .locator('[data-test="video-log-partial"]'),
    ).toHaveAttribute(
      'aria-label',
      /analytics began 40 days after publication/,
    );

    // No impressions is not a 0.0% click-through rate.
    await expect(cellOf('Real zero', ['ctr-none'])).toHaveAttribute(
      'aria-label',
      /No impressions recorded/,
    );

    // A measured rate is shown as one.
    await expect(cellOf('Measured', ['ctr-value'])).toHaveText('5.0%');

    await page.screenshot({
      path: `${OUT}/01-cell-states.png`,
      fullPage: true,
    });

    // The table scrolls inside its own container; the page does not scroll
    // sideways, at a phone width or any other.
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(videoLog.table()).toBeVisible();

    const pageScrolls = await page.evaluate(() => {
      const el = document.scrollingElement!;
      return el.scrollWidth > el.clientWidth;
    });

    expect(pageScrolls).toBe(false);

    await page.screenshot({ path: `${OUT}/02-narrow-viewport.png` });
  });

  test('says a Facebook video’s views are not measured, and sorts it last (KB-153)', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    const measured = await seedVideo(fixture, {
      videoId: fixture.publishIds[0]!,
      title: 'YouTube long cut',
      publishedAt: daysAgo(400),
    });
    await seedVideoMetrics(measured, [{ ageDays: 0, views: 1_000 }]);

    // Facebook writes NULL views (migration 020): its kinds of view are
    // its own columns, so the log has no views figure for it, not 0.
    const reel: SeededVideo = {
      videoId: fixture.publishIds[1]!,
      title: 'Facebook reel',
      publishedAt: daysAgo(400),
      projectId: fixture.project.id,
      accountId: fixture.team.accountId,
      connectionId: fixture.connectionId,
      platform: 'facebook',
    };
    await seedVideoDim(reel);
    await seedVideoMetrics(reel, [
      { ageDays: 0, views: null },
      { ageDays: 200, views: null },
    ]);

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();
    await expect(videoLog.rows()).toHaveCount(2);

    const reelRow = videoLog.rows().filter({ hasText: 'Facebook reel' });
    await expect(byTest(reelRow, 'checkpoint-not-measured').first()).toHaveText(
      'Not measured',
    );
    await expect(byTest(reelRow, 'lifetime-views-none')).toHaveText(
      'Not measured',
    );
    await expect(byTest(reelRow, 'checkpoint-figure')).toHaveCount(0);

    // Most views first: the measured video leads, the reel trails.
    await videoLog.sortBy('lifetime_views');
    await expect(videoLog.rows().first()).toContainText('YouTube long cut');
    await expect(videoLog.rows().last()).toContainText('Facebook reel');

    await page.screenshot({
      path: `${OUT}/kb153-facebook-not-measured.png`,
      fullPage: true,
    });
  });

  test('sorts and pages the whole log on the server, not the page on screen', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    // 105 videos: more than one page, so page 2 exists and the order can be
    // shown to be the log's rather than the visible rows'.
    const views = await seedManyVideos(fixture, 105);

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();

    const descending = [...views].sort((a, b) => b - a);
    const asText = (value: number | undefined) =>
      value?.toLocaleString('en-US') ?? '';

    await videoLog.sortBy('lifetime_views');

    // Wait for the sorted page, not for a row count: the previous page
    // stays on screen while the new one is read, so counting rows would
    // measure the old order and pass whatever the sort did.
    await expect(videoLog.column('lifetime-views-value').first()).toHaveText(
      asText(descending[0]),
    );
    await expect(videoLog.rows()).toHaveCount(100);
    await expect(videoLog.rangeLabel()).toHaveText('Rows 1–100');

    const firstPage = await videoLog
      .column('lifetime-views-value')
      .allTextContents();

    await page.screenshot({ path: `${OUT}/03-sorted.png`, fullPage: true });

    await videoLog.next().click();

    await expect(videoLog.column('lifetime-views-value').first()).toHaveText(
      asText(descending[100]),
    );
    await expect(videoLog.rangeLabel()).toHaveText('Rows 101–105');
    await expect(videoLog.rows()).toHaveCount(5);

    // The proof that the sort is the server's: row 101 is the 101st video of
    // the whole log by lifetime views. Sorting the hundred rows that were on
    // screen could not produce it — it was never among them.
    const secondPage = await videoLog
      .column('lifetime-views-value')
      .allTextContents();

    expect(secondPage[0]).toBe(asText(descending[100]));
    expect(firstPage).not.toContain(secondPage[0]);

    await expect(videoLog.next()).toBeDisabled();
    await page.screenshot({ path: `${OUT}/04-page-two.png`, fullPage: true });

    await videoLog.previous().click();
    await expect(videoLog.rangeLabel()).toHaveText('Rows 1–100');
  });

  test('keeps the sort when the channel changes, and the page does not', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    await seedManyVideos(fixture, 3);

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();
    await expect(videoLog.rows()).toHaveCount(3);

    await videoLog.sortBy('lifetime_views');

    const sorted = page.locator('th[aria-sort="descending"]');

    await expect(sorted).toHaveText(/Lifetime views/);

    // Filtering is not a request to be re-sorted. Resetting the sort here
    // reorders the list for no reason the reader can see.
    await videoLog.chooseChannel(fixture.connectionId);
    await expect(videoLog.rows()).toHaveCount(3);

    await expect(page.locator('th[aria-sort="descending"]')).toHaveText(
      /Lifetime views/,
    );
  });

  test('never announces a row range the rows on screen do not match', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    await seedManyVideos(fixture, 105);

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();
    await expect(videoLog.rangeLabel()).toHaveText('Rows 1–100');

    // Hold the next page's read. The previous page stays on screen while it
    // is in flight, so the label must stay with it: built from the click it
    // read "Rows 101–200" over rows 1–100, and over a page that holds 5.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    await page.route('**/*', async (route) => {
      const request = route.request();

      if (
        request.method() === 'POST' &&
        request.headers()['next-action'] &&
        (request.postData() ?? '').includes('checkpoints')
      ) {
        await held;
      }

      await route.continue();
    });

    await videoLog.next().click();
    await expect(videoLog.rows()).toHaveCount(100);
    await expect(videoLog.rangeLabel()).toHaveText('Rows 1–100');

    release();
    await expect(videoLog.rangeLabel()).toHaveText('Rows 101–105');
    await page.unroute('**/*');
  });

  test('says the log ended rather than showing an empty table past its end', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    await seedManyVideos(fixture, 105);

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();
    await expect(videoLog.rows()).toHaveCount(100);

    // The log shrinks while it is being read: everything past page 1 is gone
    // by the time Next is pressed.
    await deleteClickHouse(
      'video_dim',
      `project_id = '${fixture.project.id}' AND title LIKE 'Bulk 10%'`,
    );

    await videoLog.next().click();

    const pastEnd = byTest(page, 'video-log-past-end');

    await expect(pastEnd).toContainText('No more videos.');
    await page.screenshot({ path: `${OUT}/05-past-end.png` });

    await pastEnd.getByRole('button', { name: 'Back to first page' }).click();

    await expect(videoLog.rangeLabel()).toHaveText('Rows 1–100');
  });

  test('lists revenue per currency and never adds one currency to another', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    const video = await seedVideo(fixture, {
      videoId: fixture.publishIds[0]!,
      title: 'Two currencies',
      publishedAt: daysAgo(400),
    });

    await seedVideoMetrics(video, [{ ageDays: 1, views: 500 }]);

    await seedRevenueRecord({
      publishId: video.videoId,
      revenueCents: 1200,
      currency: 'USD',
      recordDate: '2026-01-15',
    });
    await seedRevenueRecord({
      publishId: video.videoId,
      revenueCents: 500,
      currency: 'EUR',
      recordDate: '2026-01-16',
    });

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();

    // $17.00 would be the sum of two currencies, which is not an amount of
    // money. Both are named instead.
    await expect(videoLog.column('revenue').first()).toHaveText(
      '$12.00 + €5.00',
    );

    await page.screenshot({ path: `${OUT}/06-revenue.png`, fullPage: true });
  });

  test('shows the published date on the reader’s own calendar', async ({
    browser,
  }) => {
    // 20:00 UTC on the 14th is already the 15th in Kolkata (+05:30). A date
    // built by parsing the ClickHouse timestamp as local time would show the
    // 14th here, and be right only west of UTC.
    const context = await browser.newContext({ timezoneId: 'Asia/Kolkata' });
    const page = await context.newPage();
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    const published = new Date('2026-03-14T20:00:00.000Z');
    const video = await seedVideo(fixture, {
      videoId: fixture.publishIds[0]!,
      title: 'Evening upload',
      publishedAt: published,
    });

    await seedVideoMetrics(video, [{ ageDays: 1, views: 10 }]);

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();

    const cell = videoLog.rows().first().locator('td').nth(1);

    // The 15th in Kolkata; the 14th is what a UTC day would give.
    await expect(cell).toHaveText('2026-03-15');

    await page.screenshot({ path: `${OUT}/07-local-date.png` });
    await context.close();
  });

  test('saves a note, keeps the second edit, and survives a reload', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    await seedVideoWithMetrics(fixture, 'Annotated');

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();

    await byTest(page, 'note-edit').first().click();
    await byTest(page, 'note-input').fill('Swapped thumbnail');
    await page.screenshot({ path: `${OUT}/08-note-editor.png` });
    await byTest(page, 'note-save').click();

    await expect(byTest(page, 'note-edit').first()).toContainText(
      'Swapped thumbnail',
    );

    // The second save is the one that finds state bugs: the editor reopens
    // over a note that already exists, and its conditional save must carry
    // the version the first save returned.
    await byTest(page, 'note-edit').first().click();
    await byTest(page, 'note-input').fill('Swapped on day 4');
    await byTest(page, 'note-save').click();

    await expect(byTest(page, 'note-edit').first()).toContainText(
      'Swapped on day 4',
    );

    await page.reload();
    await videoLog.openVideoLog();

    await expect(byTest(page, 'note-edit').first()).toContainText(
      'Swapped on day 4',
    );

    await page.screenshot({ path: `${OUT}/09-note-saved.png`, fullPage: true });

    // Emptying it removes it.
    await byTest(page, 'note-edit').first().click();
    await byTest(page, 'note-input').fill('');
    await byTest(page, 'note-save').click();

    await expect(byTest(page, 'note-edit').first()).toContainText('Add note');
  });

  test('refuses a note over the limit, saying what the limit is', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    await seedVideoWithMetrics(fixture, 'Long note');

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();

    await byTest(page, 'note-edit').first().click();
    await byTest(page, 'note-input').fill('x'.repeat(5001));
    await byTest(page, 'note-save').click();

    await expect(byTest(page, 'note-editor')).toContainText(
      'At most 5,000 characters',
    );

    // Nothing was saved, and the text is still there to fix.
    await expect(byTest(page, 'note-input')).toHaveValue('x'.repeat(5001));

    await page.screenshot({ path: `${OUT}/10-note-too-long.png` });
  });

  test('never overwrites someone else’s edit without saying so', async ({
    page,
    browser,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    await seedVideoWithMetrics(fixture, 'Contested');

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();

    // A second session on the same account, holding the same note.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    const otherLog = new VideoLogPageObject(otherPage);

    await signInAs(otherPage, fixture.team);
    await otherLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await otherLog.openVideoLog();

    await byTest(page, 'note-edit').first().click();
    await byTest(otherPage, 'note-edit').first().click();

    await byTest(otherPage, 'note-input').fill('Their note');
    await byTest(otherPage, 'note-save').click();
    await expect(byTest(otherPage, 'note-edit').first()).toContainText(
      'Their note',
    );

    await byTest(page, 'note-input').fill('My note');
    await byTest(page, 'note-save').click();

    const conflict = byTest(page, 'note-conflict');

    await expect(conflict).toContainText(
      'Someone else changed this note since you opened it.',
    );
    await expect(conflict).toContainText('Their note');

    await page.screenshot({ path: `${OUT}/11-note-conflict.png` });

    // The editor is still open with the typed text: nothing was lost, and
    // nothing was overwritten.
    await expect(byTest(page, 'note-input')).toHaveValue('My note');

    // Saving again is now a deliberate replacement, and it takes.
    await byTest(page, 'note-save').click();
    await expect(byTest(page, 'note-edit').first()).toContainText('My note');

    await other.close();
  });

  test('shows a reader the note without offering to edit it', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    const video = await seedVideoWithMetrics(fixture, 'Read only');

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();
    await byTest(page, 'note-edit').first().click();
    await byTest(page, 'note-input').fill('Owner note');
    await byTest(page, 'note-save').click();
    await expect(byTest(page, 'note-edit').first()).toContainText('Owner note');
    await context.close();

    // An account member who is not on the project reads the log and the
    // note, and is offered no editor for it.
    const readerContext = await browser.newContext();
    const readerPage = await readerContext.newPage();
    const reader = await seedUser('video-log-reader');

    await seedMembership(reader.userId, fixture.team.accountId, 'member');
    await signInAs(readerPage, reader);

    const readerLog = new VideoLogPageObject(readerPage);

    await readerLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await readerLog.openVideoLog();

    await expect(byTest(readerPage, 'note-readonly').first()).toHaveText(
      'Owner note',
    );
    await expect(byTest(readerPage, 'note-edit')).toHaveCount(0);

    await readerPage.screenshot({ path: `${OUT}/12-note-read-only.png` });

    expect(video.videoId).toBeTruthy();
    await readerContext.close();
  });

  test('is usable from the keyboard, and cannot lose typing to a stray click', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    await seedVideoWithMetrics(fixture, 'Keyboard');

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();

    const trigger = byTest(page, 'note-edit').first();

    await trigger.click();
    await byTest(page, 'note-input').fill('Typed, not saved');

    // A click outside with unsaved changes keeps the editor open: losing a
    // note to a misplaced click is not a recoverable mistake.
    await byTest(page, 'video-log-scope-note').click();
    await expect(byTest(page, 'note-editor')).toBeVisible();

    // Ctrl/⌘+Enter saves from the textarea.
    await byTest(page, 'note-input').press('ControlOrMeta+Enter');
    await expect(trigger).toContainText('Typed, not saved');

    // Focus comes back to the row's button, not to the top of the document.
    await expect(trigger).toBeFocused();

    // Escape discards.
    await trigger.press('Enter');
    await byTest(page, 'note-input').fill('Discarded');
    await byTest(page, 'note-input').press('Escape');

    await expect(byTest(page, 'note-editor')).toHaveCount(0);
    await expect(trigger).toContainText('Typed, not saved');

    // The explanations are reachable without a mouse: the trigger is a
    // button, and it carries the explanation for a screen reader.
    const explained = byTest(page, 'checkpoint-immature').first();

    if (await explained.count()) {
      await explained.focus();
      await expect(explained).toBeFocused();
    }
  });
});

/** One video in ClickHouse, keyed by a real publish id so notes can join. */
async function seedVideo(
  fixture: VideoLogFixture,
  video: { videoId: string; title: string; publishedAt: Date },
): Promise<SeededVideo> {
  const seeded: SeededVideo = {
    ...video,
    projectId: fixture.project.id,
    accountId: fixture.team.accountId,
    connectionId: fixture.connectionId,
  };

  await seedVideoDim(seeded);

  return seeded;
}

async function seedVideoWithMetrics(fixture: VideoLogFixture, title: string) {
  const video = await seedVideo(fixture, {
    videoId: fixture.publishIds[0]!,
    title,
    publishedAt: daysAgo(400),
  });

  await seedVideoMetrics(video, [{ ageDays: 1, views: 1_000 }]);

  return video;
}

/**
 * One video per cell state (EDD R-4), each named after the state it is in so
 * a failure says which one broke.
 */
async function seedCellStates(fixture: VideoLogFixture) {
  const measured = await seedVideo(fixture, {
    videoId: fixture.publishIds[0]!,
    title: 'Measured',
    publishedAt: daysAgo(400),
  });

  await seedVideoMetrics(measured, [
    { ageDays: 0, views: 1_000 },
    { ageDays: 200, views: 4_000 },
  ]);
  await seedVideoReach(measured, [
    { ageDays: 0, impressions: 20_000, ctr: 0.05 },
  ]);

  const zero = await seedVideo(fixture, {
    videoId: fixture.publishIds[1]!,
    title: 'Real zero',
    publishedAt: daysAgo(400),
  });

  // Rows exist and record nothing: a measured zero, not missing data.
  await seedVideoMetrics(zero, [{ ageDays: 0, views: 0 }]);

  const young = await seedVideo(fixture, {
    videoId: crypto.randomUUID(),
    title: 'Too young',
    publishedAt: daysAgo(10),
  });

  await seedVideoMetrics(young, [{ ageDays: 0, views: 300 }]);

  const late = await seedVideo(fixture, {
    videoId: crypto.randomUUID(),
    title: 'Late analytics',
    publishedAt: daysAgo(400),
  });

  // The first metric arrives 40 days in, so the 30-day window closed before
  // anything was collected and can never be filled.
  await seedVideoMetrics(late, [{ ageDays: 40, views: 900 }]);

  const none = await seedVideo(fixture, {
    videoId: crypto.randomUUID(),
    title: 'No analytics',
    publishedAt: daysAgo(400),
  });

  return [measured, zero, young, late, none];
}

/**
 * `count` videos with distinct lifetime views; returns those view counts.
 *
 * Two requests, not two per video. A row-at-a-time loop made 210 round
 * trips for a hundred videos and left 210 one-row ClickHouse parts behind,
 * which every later read in the job then merged through — a cost that
 * compounds across a suite rather than ending with the test that paid it.
 */
async function seedManyVideos(fixture: VideoLogFixture, count: number) {
  const published = daysAgo(400);

  const videos = Array.from({ length: count }, (_, index) => ({
    videoId: crypto.randomUUID(),
    projectId: fixture.project.id,
    accountId: fixture.team.accountId,
    connectionId: fixture.connectionId,
    // Padded so the titles sort the same way a human would read them.
    title: `Bulk ${String(index).padStart(3, '0')}`,
    publishedAt: new Date(published.getTime() + index * 60_000),
  }));

  // Views fall as publication gets newer, so "newest first" and "most
  // watched first" are different orders. Seeded the other way round the two
  // coincide, and a sort by date would pass a test of a sort by views —
  // which is what happened until a mutation guard stayed green.
  const views = videos.map((_, index) => 1_000 + (count - 1 - index) * 37);

  await seedVideoDims(videos);
  await seedVideoMetricsBatch(
    videos.map((video, index) => ({
      video,
      days: [{ ageDays: 1, views: views[index]! }],
    })),
  );

  return views;
}
