import { expect, test } from '@playwright/test';

/**
 * KB-20: two vendor reviews read these pages before they read anything else.
 *
 * Meta wants a data-deletion instructions URL; YouTube's developer policies
 * (III.A.1 and III.A.2) want three specific links in the privacy policy. Each
 * href below is the one the vendor's own text names, so a "tidied" URL fails
 * here rather than in a reviewer's inbox a week later.
 *
 * Public pages: no seeding, no session.
 */
const YOUTUBE_TERMS = 'https://www.youtube.com/t/terms';
const GOOGLE_PRIVACY = 'https://www.google.com/policies/privacy';
const GOOGLE_PERMISSIONS =
  'https://security.google.com/settings/security/permissions';

test.describe('Data deletion instructions', () => {
  test('the page renders and says who to ask', async ({ page }) => {
    const response = await page.goto('/data-deletion');

    expect(response?.status()).toBe(200);

    await expect(
      page.locator('[data-test="data-deletion-page"]'),
    ).toBeVisible();

    await expect(
      page.locator('[data-test="data-deletion-contact"]'),
    ).toHaveAttribute('href', /^mailto:.+@.+/);
  });

  test('it links to where access is revoked at each vendor', async ({
    page,
  }) => {
    await page.goto('/data-deletion');

    await expect(
      page.locator('[data-test="revoke-link-google"]'),
    ).toHaveAttribute('href', GOOGLE_PERMISSIONS);

    for (const vendor of ['facebook', 'instagram']) {
      await expect(
        page.locator(`[data-test="revoke-link-${vendor}"]`),
      ).toHaveAttribute('href', /^https:\/\//);
    }
  });

  test('the footer links to it, and the link resolves', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    const link = page.locator(
      '[data-test="site-footer"] a[href="/data-deletion"]',
    );

    await expect(link).toBeVisible();

    const href = await link.getAttribute('href');
    const response = await request.get(href!);

    expect(response.status()).toBe(200);
  });
});

test.describe('Privacy policy — what YouTube requires of it', () => {
  test('links the YouTube Terms of Service, the Google Privacy Policy and the Google permissions page', async ({
    page,
  }) => {
    await page.goto('/privacy-policy');

    await expect(
      page.locator('[data-test="privacy-youtube-terms-link"]'),
    ).toHaveAttribute('href', YOUTUBE_TERMS);

    await expect(
      page.locator('[data-test="privacy-google-privacy-link"]'),
    ).toHaveAttribute('href', GOOGLE_PRIVACY);

    await expect(
      page.locator('[data-test="privacy-google-permissions-link"]'),
    ).toHaveAttribute('href', GOOGLE_PERMISSIONS);
  });

  test('says how to ask for deletion, and that link resolves', async ({
    page,
    request,
  }) => {
    await page.goto('/privacy-policy');

    const link = page.locator('[data-test="privacy-data-deletion-link"]');

    await expect(link).toHaveAttribute('href', '/data-deletion');

    const response = await request.get('/data-deletion');

    expect(response.status()).toBe(200);
  });
});

test.describe('Terms of service — what YouTube requires of it', () => {
  test('links the YouTube Terms of Service', async ({ page }) => {
    await page.goto('/terms-of-service');

    await expect(
      page.locator('[data-test="terms-youtube-terms-link"]'),
    ).toHaveAttribute('href', YOUTUBE_TERMS);
  });
});

/**
 * The retention paragraphs were rendered as amber "DRAFT — BLOCKED ON OWNER
 * DECISION" boxes until the owner ruled (2026-09-22: YouTube carved out of
 * keep-until-asked, per its developer policies III.D and III.E.4). A box that
 * survives to production would be read by a vendor reviewer, so its absence is
 * asserted, and the two figures the policy fixes are read off the page.
 */
test.describe('Nothing on either page is still waiting on a decision', () => {
  for (const path of ['/data-deletion', '/privacy-policy']) {
    test(`${path} renders no DRAFT — BLOCKED box`, async ({ page }) => {
      await page.goto(path);

      await expect(
        page.locator('[data-test="blocked-on-owner-decision"]'),
      ).toHaveCount(0);
    });
  }

  test('the data-deletion page states the windows YouTube requires', async ({
    page,
  }) => {
    await page.goto('/data-deletion');

    await expect(
      page.locator('[data-test="retention-disconnect"]'),
    ).toContainText('7 calendar days');

    // KB-22: disconnecting no longer deletes what the creator entered.
    await expect(
      page.locator('[data-test="retention-disconnect"]'),
    ).toContainText('Disconnecting keeps your own records');

    await expect(page.locator('[data-test="retention-revoked"]')).toContainText(
      '30 calendar days',
    );
  });

  test('the privacy policy says how long platform data is kept', async ({
    page,
  }) => {
    await page.goto('/privacy-policy');

    const howLong = page.locator('[data-test="privacy-retention"]');

    await expect(howLong).toContainText('7 calendar days');
    await expect(howLong).toContainText('30 calendar days');
  });
});
