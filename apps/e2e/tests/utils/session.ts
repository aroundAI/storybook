import { Page } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';

/**
 * Signs a seeded user in and waits for the app to settle on a route.
 *
 * Pairs with `seedUser` / `seedTeamAccount`: the account already exists and is
 * confirmed, so this is the one browser flow a test needs before it can start
 * — not sign-up, a confirmation mail and a sign-out as well.
 *
 * The password step stays a real UI interaction on purpose. Suites that seed
 * their fixtures still want to be running against a genuinely authenticated
 * session rather than one injected into storage, and `auth.spec.ts` remains
 * the place that covers the form itself.
 */
export async function signInAs(
  page: Page,
  user: { email: string; password: string },
  landing?: string,
) {
  const auth = new AuthPageObject(page);

  await page.goto('/auth/sign-in');

  await auth.signIn({ email: user.email, password: user.password });

  if (landing) {
    await page.waitForURL(`**${landing}`);
  } else {
    await waitForSignedIn(page);
  }
}

/**
 * Where a signed-in person settles: a page under `/home/<something>`.
 *
 * Not `/home` itself. The product is team accounts only (KB-99), so `/home`
 * only redirects: to the person's first team, or to `/home/teams/create`
 * when they have none. Waiting for `/home` waits for a URL that never stays.
 */
export function isSignedInLanding(url: URL) {
  return /^\/home\/[^/]+/.test(url.pathname);
}

export async function waitForSignedIn(page: Page) {
  await page.waitForURL(isSignedInLanding);
}
