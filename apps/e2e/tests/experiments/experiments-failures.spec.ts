import { Page, expect, test } from '@playwright/test';

import { readRows, seedExperiment, seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * A failed read or write must say so (FILM-1610 review, A3 and A4).
 *
 * Same technique as `deep-dive/read-failures.spec.ts`: abort one server
 * action, chosen by its serialized argument list, and leave the rest of the
 * page alone. React Query retries a failed read three times with backoff, so
 * error states get an explicit timeout.
 */
const ERROR_STATE = { timeout: 20_000 };

function argsOf(body: string): Record<string, unknown> | null {
  try {
    const [args] = JSON.parse(body) as Array<Record<string, unknown>>;
    return args ?? null;
  } catch {
    return null;
  }
}

async function onAction(
  page: Page,
  matches: (args: Record<string, unknown>) => boolean,
  handle: 'abort' | { delayMs: number; seen: string[] },
) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const args =
      request.method() === 'POST' && request.headers()['next-action']
        ? argsOf(request.postData() ?? '')
        : null;

    if (!args || !matches(args)) {
      await route.continue();
      return;
    }

    if (handle === 'abort') {
      await route.abort('failed');
      return;
    }

    // The action id, not the body: the start and the detail refetch after
    // it send the same `{ experimentId }` and differ only in which action.
    handle.seen.push(request.headers()['next-action'] ?? '');
    await new Promise((resolve) => setTimeout(resolve, handle.delayMs));
    await route.continue();
  });
}

/**
 * The account-scoped reads: the log, the due list, the channels and the
 * videos. Matched as "has accountId, is not about one experiment" rather
 * than by listing each read's keys: that list broke twice, each time a read
 * gained a parameter (the due list's `asOf`, the picker's `search`) and
 * silently stopped being aborted.
 */
const accountRead = (args: Record<string, unknown>) =>
  'accountId' in args && !('experimentId' in args);

/**
 * The start action, told apart by its `startedAt`. Matching on
 * `{ experimentId }` alone would also catch the detail read — and once start
 * began sending a date, that matcher silently stopped seeing start at all,
 * leaving the double-click test counting the wrong request and passing.
 */
const startAction = (args: Record<string, unknown>) =>
  'experimentId' in args && 'startedAt' in args;

test.describe('Experiment log — failures (FILM-1610)', () => {
  test('failed reads are reported, not shown as an empty log', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    await seedExperiment(team.accountId, { title: 'Exists but unread' });

    await signInAs(page, team);
    // Every account-scoped read on this page: the log, the due list, the
    // channels and the videos. None of them may claim to be empty.
    await onAction(page, accountRead, 'abort');
    await page.goto(`/home/${team.slug}/studio/analytics/experiments`);

    await expect(
      page.locator('[data-test="experiment-list-error"]:visible'),
    ).toBeVisible(ERROR_STATE);
    await expect(
      page.locator('[data-test="experiments-due-error"]:visible'),
    ).toBeVisible(ERROR_STATE);

    await expect(page.getByText('No changes logged yet')).toHaveCount(0);
    await expect(byTest(page, 'experiments-due-empty')).toHaveCount(0);
    await expect(byTest(page, 'video-picker-empty')).toHaveCount(0);
  });

  test('a failed start says so and leaves the experiment planned', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const id = await seedExperiment(team.accountId, { title: 'Will fail' });

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/analytics/experiments`);
    await page.locator(`[data-test="experiment-row-${id}"]:visible`).click();

    const start = page.getByRole('button', { name: 'Start', exact: true });
    await expect(start).toBeVisible();

    await onAction(page, startAction, 'abort');
    await start.click();

    await expect(byTest(page, 'experiment-action-error')).toBeVisible();
    await expect(page.getByText('Started — baseline captured')).toHaveCount(0);
    await expect(start).toBeEnabled();
  });

  test('a double click starts the experiment once', async ({ page }) => {
    const team = await seedTeamAccount();
    const id = await seedExperiment(team.accountId, { title: 'Double click' });

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/analytics/experiments`);
    await page.locator(`[data-test="experiment-row-${id}"]:visible`).click();

    const start = page.getByRole('button', { name: 'Start', exact: true });
    await expect(start).toBeVisible();

    const seen: string[] = [];
    await onAction(page, startAction, { delayMs: 1500, seen });
    await start.dblclick();

    await expect(page.getByText('Started — baseline captured')).toBeVisible();

    // Every request `seen` is a start; the double click must send one.
    expect(seen).toHaveLength(1);
  });

  test('two clicks in the same instant send one start', async ({ page }) => {
    // The disabled state only applies once React re-renders, so it cannot
    // stop a second click that lands in the same task as the first. That is
    // what the in-flight ref is for, and a double click does not reach it:
    // Playwright lets the page re-render between the two clicks.
    const team = await seedTeamAccount();
    const id = await seedExperiment(team.accountId, { title: 'Same instant' });

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/analytics/experiments`);
    await page.locator(`[data-test="experiment-row-${id}"]:visible`).click();

    const start = page.getByRole('button', { name: 'Start', exact: true });
    await expect(start).toBeVisible();

    const seen: string[] = [];
    await onAction(page, startAction, { delayMs: 1500, seen });

    await start.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });

    await expect(page.getByText('Started — baseline captured')).toBeVisible();
    expect(seen).toHaveLength(1);
  });

  test('a second tab left open cannot start the experiment again', async ({
    browser,
  }) => {
    const team = await seedTeamAccount();
    const id = await seedExperiment(team.accountId, { title: 'Two tabs' });

    // Two sessions on the same experiment, both showing it as planned.
    const [first, second] = await Promise.all([
      browser.newContext().then((context) => context.newPage()),
      browser.newContext().then((context) => context.newPage()),
    ]);

    for (const page of [first!, second!]) {
      await signInAs(page, team);
      await page.goto(`/home/${team.slug}/studio/analytics/experiments`);
      await page.locator(`[data-test="experiment-row-${id}"]:visible`).click();
      await expect(
        page.getByRole('button', { name: 'Start', exact: true }),
      ).toBeVisible();
    }

    await first!.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(first!.getByText('Started — baseline captured')).toBeVisible();

    const [before] = await readRows<{
      started_at: string;
      baseline_metrics: unknown;
    }>(
      'analytics_experiments',
      `select=started_at,baseline_metrics&id=eq.${id}`,
    );

    // The second tab still shows Start. Pressing it must not restart the
    // experiment or replace the baseline the first tab captured.
    await second!.getByRole('button', { name: 'Start', exact: true }).click();
    // The wording, not only that something appeared: a production build
    // replaces a *thrown* server-action message with "An error occurred in
    // the Server Components render…", which is visible too (review 4, G1).
    // ⚫️ Test runs this against a production build, where that shows.
    await expect(
      second!.locator('[data-test="experiment-action-error"]'),
    ).toHaveText('Only a planned change can be started; this one is running.');

    const [after] = await readRows<{
      started_at: string;
      baseline_metrics: unknown;
    }>(
      'analytics_experiments',
      `select=started_at,baseline_metrics&id=eq.${id}`,
    );
    expect(after).toEqual(before);
  });
});
