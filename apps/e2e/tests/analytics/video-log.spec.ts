import { Page, Request, expect, test } from '@playwright/test';

import { byTest } from '../utils/visible';
import { VideoLogPageObject } from './video-log.po';

/**
 * The Video Log's wiring (FILM-1615).
 *
 * ClickHouse is off in this job, so the table has no rows to show and the
 * tab renders its empty state. What a browser can still prove here is
 * everything that does not need a figure: that the tab mounts, that the
 * request reaching the server carries the page and sort the UI claims, that
 * the channel selection is one selection shared with the Deep Dive, and that
 * a failed read says so rather than rendering as "no videos".
 *
 * The figures, the sort order, the paging and the notes need rows, so they
 * are asserted in `video-log-evidence.spec.ts`, which runs against a
 * ClickHouse container in the 🧬 E2E job.
 *
 * Runs on the production build, where a thrown server-action message is
 * replaced by a generic one — so the texts below are asserted exactly.
 */

/** One request plus React Query's three retries, then backoff. */
const ERROR_STATE = { timeout: 20_000 };

type ActionArgs = Record<string, unknown>;

/** The arguments of every server action the page called. */
function recordActionCalls(page: Page) {
  const calls: ActionArgs[] = [];

  page.on('request', (request: Request) => {
    if (request.method() !== 'POST' || !request.headers()['next-action']) {
      return;
    }

    try {
      const [args] = JSON.parse(request.postData() ?? '[]') as ActionArgs[];

      if (args) calls.push(args);
    } catch {
      // Multipart bodies are uploads, not the actions under test.
    }
  });

  return calls;
}

const videoLogCalls = (calls: ActionArgs[]) =>
  calls.filter((call) => Array.isArray(call.checkpoints));

async function routeVideoLogAction(
  page: Page,
  handler: (route: import('@playwright/test').Route) => Promise<void>,
) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const body = request.postData() ?? '';

    if (
      request.method() === 'POST' &&
      request.headers()['next-action'] &&
      body.includes('checkpoints')
    ) {
      await handler(route);
      return;
    }

    await route.continue();
  });
}

test.describe('Video Log', () => {
  test('asks the server for one page, newest first, and says the table holds one page', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();
    const calls = recordActionCalls(page);

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();

    await expect
      .poll(() => videoLogCalls(calls).length, { timeout: 10_000 })
      .toBeGreaterThan(0);

    const request = videoLogCalls(calls)[0];

    expect(request).toMatchObject({
      projectId: fixture.project.id,
      orderBy: 'published_at',
      orderDirection: 'desc',
      offset: 0,
    });

    // 101, not 100: the row past the page is how "is there another page" is
    // answered without counting the whole log. A plain 100 would leave the
    // Next button guessing.
    expect(request?.limit).toBe(101);

    // The date range does not reach this table, and it has no totals.
    // Saying so is the only thing that stops a reader assuming both. The
    // platform filter does reach it (FILM-1709).
    await expect(byTest(page, 'video-log-scope-note')).toContainText(
      'Every video on the selected platforms',
    );
    await expect(byTest(page, 'video-log-scope-note')).toContainText(
      'The date range above does not apply here, and there is no total',
    );
  });

  test('says there are no videos yet, and why they would appear', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();

    const empty = byTest(page, 'video-log-empty');

    await expect(empty).toContainText('No videos with analytics yet.');
    await expect(empty).toContainText(
      'Videos appear here after their first analytics sync.',
    );

    // Neither a table nor paging controls: there is nothing to page.
    await expect(videoLog.table()).toHaveCount(0);
    await expect(videoLog.next()).toHaveCount(0);
  });

  test('names the channel filter as the reason a filtered log is empty', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();
    await videoLog.chooseChannel(fixture.connectionId);

    await expect(byTest(page, 'video-log-empty')).toContainText(
      'No videos from this channel have analytics yet.',
    );
  });

  test('the channel picked in the Deep Dive is the channel the Video Log shows', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();
    const calls = recordActionCalls(page);

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openDeepDive();

    await byTest(page, 'channel-filter-trigger').click();
    await page
      .locator(`[data-test="channel-filter-option-${fixture.connectionId}"]`)
      .click();

    await videoLog.openVideoLog();

    // Not just the label: the id the Video Log's own read carried.
    await expect(videoLog.channelFilter()).toHaveText('Main Channel');
    await expect
      .poll(
        () =>
          videoLogCalls(calls).filter(
            (call) => call.connectionId === fixture.connectionId,
          ).length,
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
  });

  test('the channel picked in the Video Log is the channel the Deep Dive shows', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();
    await videoLog.chooseChannel(fixture.secondConnectionId);

    await videoLog.openDeepDive();

    await expect(byTest(page, 'channel-filter-trigger')).toHaveText(
      'Second Channel',
    );
  });

  test('shows it is loading rather than an empty log it has not read yet', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    await routeVideoLogAction(page, async (route) => {
      await held;
      await route.continue();
    });

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();

    const loading = byTest(page, 'video-log-loading');

    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute('aria-busy', 'true');

    // The claim that must not be made while the read is in flight.
    await expect(byTest(page, 'video-log-empty')).toHaveCount(0);

    release();

    await expect(byTest(page, 'video-log-empty')).toBeVisible();
  });

  test('a failed read is reported, not shown as a project with no videos', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();

    await routeVideoLogAction(page, (route) => route.abort('failed'));

    await videoLog.goToAnalytics(fixture.team.slug, fixture.project.slug);
    await videoLog.openVideoLog();

    const error = byTest(page, 'video-log-error');

    await expect(error).toBeVisible(ERROR_STATE);
    await expect(error).toContainText('The Video Log could not be loaded.');
    await expect(error).toHaveAttribute('role', 'alert');

    // An unread log is not an empty one, and must not read as one.
    await expect(byTest(page, 'video-log-empty')).toHaveCount(0);

    // Try again re-reads: with the abort lifted, the read succeeds.
    await page.unroute('**/*');
    await byTest(page, 'video-log-retry').click();

    await expect(byTest(page, 'video-log-empty')).toBeVisible(ERROR_STATE);
  });
});
