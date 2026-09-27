import { Browser, Page, expect, selectors, test } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import {
  SeededTeam,
  SeededUser,
  readRows,
  seedMembership,
  seedProject,
  seedTeamAccount,
  seedUser,
  uniqueStamp,
} from '../utils/seed';
import { waitForSignedIn } from '../utils/session';
import { SUPER_ADMIN_STORAGE_STATE } from '../utils/super-admin';

test.describe('Admin Auth flow without MFA', () => {
  test('will return a 404 for non-admin users', async ({ page }) => {
    const auth = new AuthPageObject(page);

    await page.goto('/auth/sign-in');

    await auth.signIn({
      email: 'owner@storybook.dev',
      password: 'testingpassword',
    });

    await waitForSignedIn(page);

    await page.goto('/admin');

    expect(page.url()).toContain('/404');
  });

  test('will redirect to 404 for admin users without MFA', async ({ page }) => {
    const auth = new AuthPageObject(page);

    await page.goto('/auth/sign-in');

    await auth.signIn({
      email: 'test@storybook.dev',
      password: 'testingpassword',
    });

    await waitForSignedIn(page);

    await page.goto('/admin');

    expect(page.url()).toContain('/404');
  });
});

test.describe('Admin', () => {
  /*
   * Starts from the session the setup project saved, so no test signs in or
   * completes a TOTP challenge of its own.
   *
   * This block used to be `mode: 'serial'`, with the comment "OTP
   * verification is not working in parallel" — and serial mode skips every
   * remaining test in the block when one fails, so a single rejected code
   * cost all eight. The reason for it is gone: the tests never shared state,
   * only the MFA flow, and that now happens once per run.
   */
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test.describe('Admin Dashboard', () => {
    test('displays all stat cards', async ({ page }) => {
      await page.goto('/admin');

      // Check all stat cards are present
      await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

      await expect(
        page.getByRole('heading', { name: 'Team Accounts' }),
      ).toBeVisible();

      await expect(
        page.getByRole('heading', { name: 'Paying Customers' }),
      ).toBeVisible();

      await expect(page.getByRole('heading', { name: 'Trials' })).toBeVisible();

      // Verify stat values are numbers
      const stats = await page.$$('.text-3xl.font-bold');

      for (const stat of stats) {
        const value = await stat.textContent();
        expect(Number.isInteger(Number(value))).toBeTruthy();
      }
    });
  });

  test.describe('Personal Account Management', () => {
    let testUser: SeededUser;

    test.beforeEach(async ({ page }) => {
      selectors.setTestIdAttribute('data-test');

      // Seeded through the admin API rather than the sign-up form. The user
      // is a fixture here, not the subject: driving sign-up, waiting on the
      // confirmation mail and signing out again put three unrelated flows in
      // front of every admin assertion.
      testUser = await seedUser('admin');

      await page.goto(`/admin/accounts`);

      await filterAccounts(page, testUser.name);
      await selectAccount(page, testUser.name);
    });

    test('displays personal account details', async ({ page }) => {
      await expect(page.getByText('Personal Account')).toBeVisible();
      await expect(page.getByTestId('admin-ban-account-button')).toBeVisible();
      await expect(page.getByTestId('admin-impersonate-button')).toBeVisible();
      await expect(
        page.getByTestId('admin-delete-account-button'),
      ).toBeVisible();
    });

    test('ban user flow', async ({ page, browser }) => {
      await page.getByTestId('admin-ban-account-button').click();
      await expect(
        page.getByRole('heading', { name: 'Ban User' }),
      ).toBeVisible();

      // Try with invalid confirmation
      await page.fill('[placeholder="Type CONFIRM to confirm"]', 'WRONG');
      await page.getByRole('button', { name: 'Ban User' }).click();

      await expect(
        page.getByRole('heading', { name: 'Ban User' }),
      ).toBeVisible(); // Dialog should still be open

      await confirmBan(page);

      await withSignedOutPage(browser, async (signedOut) => {
        await signIn(signedOut, testUser);

        await expect(
          signedOut.locator('[data-test="auth-error-message"]'),
        ).toBeVisible();
      });
    });

    test('reactivate user flow', async ({ page, browser }) => {
      await page.getByTestId('admin-ban-account-button').click();
      await confirmBan(page);

      // Now reactivate
      await page.getByTestId('admin-reactivate-account-button').click();

      await expect(
        page.getByRole('heading', { name: 'Reactivate User' }),
      ).toBeVisible();

      await page.fill('[placeholder="Type CONFIRM to confirm"]', 'CONFIRM');

      await submitAdminAction(page, 'Reactivate User');

      // Reload until the badge is gone, rather than asserting once and hoping
      // the page has caught up.
      //
      // The action redirects to the URL it is already on, and a redirect to
      // the current route does not reliably force a re-render from the
      // server — so the badge can still be pre-action markup while the
      // database is already correct. Verified at the time: the server logs
      // the reactivation as successful, `banned_until` is NULL, and loading
      // the same page in a fresh context shows no badge.
      //
      // An earlier version of this waited for the dialog to close and then
      // reloaded once. That passed three runs and then failed two, because it
      // was still a single observation of a timing-dependent state — the same
      // mistake in a new place. `toPass` retries the whole reload-and-check,
      // so it is the *outcome* being waited on. A reactivation that genuinely
      // failed still fails this, it just fails at the timeout.
      //
      // `toHaveCount(0)` on a test id, not `getByText('Banned')`: the text
      // locator had `.first()` when asserting presence and not when asserting
      // absence, so the negative case was a strict-mode hazard the moment
      // anything else on the page said "Banned".
      await expect(async () => {
        await page.reload();
        await expect(page.getByTestId('admin-banned-badge')).toHaveCount(0);
      }).toPass();

      await withSignedOutPage(browser, async (signedOut) => {
        await signIn(signedOut, testUser);

        await waitForSignedIn(signedOut);
      });
    });

    test('impersonate user flow', async ({ page }) => {
      await page.getByTestId('admin-impersonate-button').click();

      await expect(
        page.getByRole('heading', { name: 'Impersonate User' }),
      ).toBeVisible();

      await page.fill('[placeholder="Type CONFIRM to confirm"]', 'CONFIRM');
      await page.getByRole('button', { name: 'Impersonate User' }).click();

      // Should redirect to home and be logged in as the user
      await waitForSignedIn(page);
    });

    test('delete user flow', async ({ page, browser, baseURL }) => {
      // FILM-CC-04 KB-1. This flow used to pass only because its user had
      // never created anything: `projects.created_by` referenced auth.users
      // with no ON DELETE action, so the first project made a user
      // undeletable. The project lives on a colleague's team, so it outlives
      // its author and can be read back afterwards.
      const team = await seedTeamAccount({ emailPrefix: 'admin-kb1-owner' });
      await seedMembership(testUser.userId, team.accountId);

      const project = await seedProject({
        email: testUser.email,
        password: testUser.password,
        accountId: team.accountId,
      });

      const before = await readRows<{ created_by: string | null }>(
        'projects',
        `id=eq.${project.id}&select=created_by`,
      );

      // Otherwise "no author" below is true of a project nobody authored.
      expect(before).toEqual([{ created_by: testUser.userId }]);

      await page.getByTestId('admin-delete-account-button').click();

      await expect(
        page.getByRole('heading', { name: 'Delete User' }),
      ).toBeVisible();

      // Try with invalid confirmation
      await page.fill('[placeholder="Type CONFIRM to confirm"]', 'WRONG');

      await page.getByRole('button', { name: 'Delete' }).click();

      await expect(
        page.getByRole('heading', { name: 'Delete User' }),
      ).toBeVisible(); // Dialog should still be open

      // Confirm with correct text
      await page.fill('[placeholder="Type CONFIRM to confirm"]', 'CONFIRM');

      await page.getByRole('button', { name: 'Delete' }).click();

      // Should redirect to admin dashboard. A refused delete stays on the
      // account page, and the test fails here.
      await page.waitForURL('/admin/accounts');

      // The deleted user can't sign in. Tried from a browser that was never
      // the admin's: clearing this page's cookies left its auth listener to
      // redirect whenever it noticed, which raced every navigation after it.
      // The empty storageState matters: without it the project's saved admin
      // session is applied, and the sign-in page redirects to the dashboard.
      const visitor = await browser.newContext({
        baseURL,
        storageState: { cookies: [], origins: [] },
      });
      const signInPage = await visitor.newPage();

      await signInPage.goto('/auth/sign-in');

      await new AuthPageObject(signInPage).signIn({
        email: testUser.email,
        password: testUser.password,
      });

      await expect(
        signInPage.locator('[data-test="auth-error-message"]'),
      ).toBeVisible();

      await visitor.close();

      // The project stays with the team, with no author.
      const after = await readRows<{ created_by: string | null }>(
        'projects',
        `id=eq.${project.id}&select=created_by`,
      );

      expect(after).toEqual([{ created_by: null }]);
    });
  });

  test.describe('Team Account Management', () => {
    test.skip(
      process.env.ENABLE_TEAM_ACCOUNT_TESTS !== 'true',
      'Team account tests are disabled',
    );

    let team: SeededTeam;

    test.beforeEach(async ({ page }) => {
      selectors.setTestIdAttribute('data-test');

      // `create_team_account` through the API, which is the same function the
      // product calls — so the fixture cannot drift from what a real team
      // looks like, and no part of it depends on the create-team dialog.
      team = await seedTeamAccount({ name: `Admin ${uniqueStamp()}` });

      await page.goto(`/admin/accounts`);

      await filterAccounts(page, team.name);
      await selectAccount(page, team.name);
    });

    test('displays team account details', async ({ page }) => {
      await expect(page.getByText('Team Account')).toBeVisible();
      await expect(
        page.getByTestId('admin-delete-account-button'),
      ).toBeVisible();
    });

    test('delete team account flow', async ({ page }) => {
      await page.getByTestId('admin-delete-account-button').click();
      await expect(
        page.getByRole('heading', { name: 'Delete Account' }),
      ).toBeVisible();

      // Try with invalid confirmation
      await page.fill('[placeholder="Type CONFIRM to confirm"]', 'WRONG');
      await page.getByRole('button', { name: 'Delete' }).click();
      await expect(
        page.getByRole('heading', { name: 'Delete Account' }),
      ).toBeVisible(); // Dialog should still be open

      // Confirm with correct text
      await page.fill('[placeholder="Type CONFIRM to confirm"]', 'CONFIRM');
      await page.getByRole('button', { name: 'Delete' }).click();

      // Should redirect to admin dashboard after deletion
      await expect(page).toHaveURL('/admin/accounts');
    });
  });
});

async function filterAccounts(page: Page, query: string) {
  await page
    .locator('[data-test="admin-accounts-table-filter-input"]')
    .first()
    .fill(query);

  // Enter submits a react-hook-form that pushes a new querystring; the table
  // is re-rendered by the server from the new searchParams. There was a
  // `waitForTimeout(250)` here guessing at how long that takes — `toPass` in
  // selectAccount already waits for the row it needs, so the sleep only
  // delayed the first attempt.
  await page.keyboard.press('Enter');
}

async function selectAccount(page: Page, name: string) {
  await expect(async () => {
    const link = page.locator('tr', { hasText: name }).locator('a');

    await expect(link).toBeVisible();

    await link.click();

    // The account page's own URL, rather than `networkidle`. Playwright's
    // docs discourage networkidle as inherently flaky, and it answers "did
    // the network go quiet" when the question is "are we on the account
    // page".
    await page.waitForURL(/\/admin\/accounts\//);
  }).toPass();
}

/**
 * Submits an admin dialog's server action and waits for its response.
 *
 * The response wait is not the assertion — callers reload until the page
 * shows the outcome. It is here because a reload unloads the page, and a
 * request not yet sent (the form validates first) or still in flight is
 * cancelled with it: the action never lands and the reload loop runs out
 * the test timeout.
 */
async function submitAdminAction(page: Page, buttonName: string) {
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/admin/accounts') &&
        response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: buttonName }).click(),
  ]);
}

/**
 * Confirms the open ban dialog and waits until the page shows the badge.
 *
 * `banUserAction` redirects to the route it is already on, which does not
 * reliably re-render from the server, and the ban dialog — unlike
 * reactivate — does not call `router.refresh()`. A single visibility check
 * could time out against pre-action markup while the user is already
 * banned, so this reloads until the page says so.
 */
async function confirmBan(page: Page) {
  await page.fill('[placeholder="Type CONFIRM to confirm"]', 'CONFIRM');

  await submitAdminAction(page, 'Ban User');

  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('admin-banned-badge')).toBeVisible();
  }).toPass();
}

/**
 * Runs `check` in a fresh, signed-out browser context.
 *
 * These checks used to clear cookies on the admin page and navigate it to
 * sign-in. But that page is still mounted, and `useAuthChangeListener`
 * sends a private route that loses its session to `/` with
 * `window.location.assign` — racing the test's own `goto`, which Chrome
 * then aborts (`net::ERR_ABORTED`, captured on the landing page in CI). A
 * separate context has no admin page to react.
 */
async function withSignedOutPage(
  browser: Browser,
  check: (page: Page) => Promise<void>,
) {
  // Explicitly empty: contexts created here inherit the project's `use`
  // options, including the super-admin `storageState` this block sets.
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });

  try {
    await check(await context.newPage());
  } finally {
    await context.close();
  }
}

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto('/auth/sign-in');

  await new AuthPageObject(page).signIn({
    email: user.email,
    password: user.password,
  });
}
