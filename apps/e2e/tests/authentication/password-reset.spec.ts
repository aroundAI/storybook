import { expect, test } from '@playwright/test';

import { AuthPageObject } from './auth.po';
import { isSignedInLanding, waitForSignedIn } from '../utils/session';

const newPassword = (Math.random() * 10000).toString();

test.describe('Password Reset Flow', () => {
  test('will reset the password and sign in with new one', async ({ page }) => {
    const auth = new AuthPageObject(page);

    let email = '';

    await expect(async () => {
      email = auth.createRandomEmail();

      await page.goto('/auth/sign-up');

      await auth.signUp({
        email,
        password: 'password',
        repeatPassword: 'password',
      });

      await auth.visitConfirmEmailLink(email, {
        deleteAfter: true,
        subject: 'Confirm your email',
      });

      await page.context().clearCookies();
      await page.reload();

      await page.goto('/auth/password-reset');

      await page.fill('[name="email"]', email);
      await page.click('[type="submit"]');

      await auth.visitConfirmEmailLink(email, {
        deleteAfter: true,
        subject: 'Reset your password',
      });

      await page.waitForURL('/update-password', {
        timeout: 1000,
      });

      await auth.updatePassword(newPassword);

      await page
        .locator('a', {
          hasText: 'Back to Home Page',
        })
        .click();

      await waitForSignedIn(page);
    }).toPass();

    await auth.signOut();

    await page.waitForURL('/');
    await page.goto('/auth/sign-in');

    await auth.signIn({
      email,
      password: newPassword,
    });

    await page.waitForURL(isSignedInLanding, {
      timeout: 2000,
    });
  });
});
