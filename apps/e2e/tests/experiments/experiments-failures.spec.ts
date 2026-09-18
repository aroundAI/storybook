import { Page, expect, test } from '@playwright/test';

import { seedExperiment, seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';

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

const onlyAccountId = (args: Record<string, unknown>) =>
  Object.keys(args).join() === 'accountId';

const onlyExperimentId = (args: Record<string, unknown>) =>
  Object.keys(args).join() === 'experimentId';

test.describe('Experiment log — failures (FILM-1610)', () => {
  test('failed reads are reported, not shown as an empty log', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    await seedExperiment(team.accountId, { title: 'Exists but unread' });

    await signInAs(page, team);
    // Every account-scoped read on this page: the log, the due list, the
    // channels and the videos. None of them may claim to be empty.
    await onAction(page, onlyAccountId, 'abort');
    await page.goto(`/home/${team.slug}/studio/analytics/experiments`);

    await expect(
      page.locator('[data-test="experiment-list-error"]:visible'),
    ).toBeVisible(ERROR_STATE);
    await expect(
      page.locator('[data-test="experiments-due-error"]:visible'),
    ).toBeVisible(ERROR_STATE);

    await expect(page.getByText('No experiments logged yet')).toHaveCount(0);
    await expect(
      page.locator('[data-test="experiments-due-empty"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-test="video-picker-empty"]')).toHaveCount(
      0,
    );
  });

  test('a failed start says so and leaves the experiment planned', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const id = await seedExperiment(team.accountId, { title: 'Will fail' });

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/analytics/experiments`);
    await page.locator(`[data-test="experiment-row-${id}"]:visible`).click();

    const start = page.getByRole('button', { name: 'Start experiment' });
    await expect(start).toBeVisible();

    // Installed only now: the detail read has the same argument shape.
    await onAction(page, onlyExperimentId, 'abort');
    await start.click();

    await expect(
      page.locator('[data-test="experiment-action-error"]'),
    ).toBeVisible();
    await expect(page.getByText('Experiment started')).toHaveCount(0);
    await expect(start).toBeEnabled();
  });

  test('a double click starts the experiment once', async ({ page }) => {
    const team = await seedTeamAccount();
    const id = await seedExperiment(team.accountId, { title: 'Double click' });

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/analytics/experiments`);
    await page.locator(`[data-test="experiment-row-${id}"]:visible`).click();

    const start = page.getByRole('button', { name: 'Start experiment' });
    await expect(start).toBeVisible();

    const seen: string[] = [];
    await onAction(page, onlyExperimentId, { delayMs: 1500, seen });
    await start.dblclick();

    await expect(page.getByText('Experiment started')).toBeVisible();

    // The first request is the start; count how often that action was sent.
    const startAction = seen[0];
    expect(seen.filter((id) => id === startAction)).toHaveLength(1);
  });
});
