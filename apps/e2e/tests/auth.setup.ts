import { expect, test as setup } from '@playwright/test';

import { AuthPageObject } from './authentication/auth.po';
import { SUPER_ADMIN, SUPER_ADMIN_STORAGE_STATE } from './utils/super-admin';

/**
 * Signs in as the super-admin once and saves the session for every admin test.
 *
 * Before this, `admin.spec.ts` drove a full sign-in and TOTP challenge in
 * `beforeEach` — eight times per run, and again on each of three retries. The
 * TOTP code is valid for a 30-second window, so a proportion of attempts were
 * always going to be rejected, and the block was marked
 * `mode: 'serial'` ("OTP verification is not working in parallel"), which
 * turns one rejected code into eight skipped tests.
 *
 * Doing it once here collapses that to a single challenge per run. The saved
 * state has to be captured *after* the challenge: `public.is_super_admin()`
 * short-circuits on `aal != 'aal2'`, so a session that skipped MFA reaches
 * `/admin` and gets a 404 — which is what two deliberate tests assert.
 *
 * The retry ladder lives here rather than in a test because it is allowed to
 * outlast a test: the project sets its own timeout, whereas in `beforeEach` a
 * ladder summing to 285s sat under a 120s test timeout and could never
 * finish — it just consumed the budget the test body needed.
 */
setup('authenticate as super-admin', async ({ page }) => {
  const auth = new AuthPageObject(page);

  await page.goto('/auth/sign-in');

  await auth.signIn({
    email: SUPER_ADMIN.email,
    password: SUPER_ADMIN.password,
  });

  await page.waitForURL('**/auth/verify');

  await expect(async () => {
    await auth.submitMFAVerification(SUPER_ADMIN.mfaKey);
    await page.waitForURL('**/home');
  }).toPass({ intervals: [1000, 5000, 15_000, 30_000, 35_000] });

  // Proves the session is actually AAL2 before it is saved. Landing on /home
  // only shows the password step succeeded; reaching /admin is what shows the
  // MFA claim is present, and saving a session that cannot open /admin would
  // fail every admin test with a 404 that looks like a product bug.
  await page.goto('/admin');
  await expect(page).not.toHaveURL(/404/);

  await page.context().storageState({ path: SUPER_ADMIN_STORAGE_STATE });
});
