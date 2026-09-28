import { expect, test } from '@playwright/test';

import { byTest } from '../utils/visible';

/**
 * Screenshots for the KB-20 pull request: the legal text is the owner's to
 * approve, and approving it means reading it as a visitor would.
 *
 * Not a guard — `data-deletion.spec.ts` holds those. Skipped unless
 * CAPTURE_EVIDENCE is set, so it costs CI nothing.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

// An element taller than the viewport is captured in strips, and the sticky
// site header lands across the middle of each one.
const UNSTICK_HEADER = '.site-header { position: static !important; }';

test.describe('Data deletion and privacy policy — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('captures what a visitor and a vendor reviewer now see', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto('/data-deletion');
    await page.addStyleTag({ content: UNSTICK_HEADER });

    const deletionPage = byTest(page, 'data-deletion-page');

    await expect(deletionPage).toBeVisible();
    await deletionPage.screenshot({ path: `${OUT}/01-data-deletion-page.png` });

    await page.goto('/privacy-policy');
    await page.addStyleTag({ content: UNSTICK_HEADER });

    const thirdParties = page.locator('#section-1');

    await expect(byTest(page, 'privacy-youtube-terms-link')).toBeVisible();

    await thirdParties.screenshot({
      path: `${OUT}/02-privacy-section-1-platform-data.png`,
    });

    // §5's "Analytics" row now defers to §1.4 rather than naming a period
    // nothing enforces.
    const retention = page.locator('#section-5');

    await retention.screenshot({
      path: `${OUT}/02b-privacy-section-5-retention.png`,
    });

    const rights = page.locator('#section-6');

    await expect(byTest(page, 'privacy-google-permissions-link')).toBeVisible();

    await rights.screenshot({ path: `${OUT}/03-privacy-section-6-rights.png` });

    await page.goto('/terms-of-service');
    await page.addStyleTag({ content: UNSTICK_HEADER });

    const integrations = page.locator('#section-5');

    await expect(byTest(page, 'terms-youtube-terms-link')).toBeVisible();

    await integrations.screenshot({
      path: `${OUT}/04-terms-section-5-youtube.png`,
    });

    await page.goto('/');
    await page.addStyleTag({ content: UNSTICK_HEADER });

    const footer = byTest(page, 'site-footer');

    await expect(footer.locator('a[href="/data-deletion"]')).toBeVisible();
    await footer.scrollIntoViewIfNeeded();
    await footer.screenshot({ path: `${OUT}/05-footer-link.png` });
  });
});
