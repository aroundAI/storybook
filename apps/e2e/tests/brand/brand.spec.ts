import { type Page, expect, test } from '@playwright/test';

import { byTest } from '../utils/visible';

/**
 * The header wears StoryBook's brand lockup, rendered from
 * packages/branding/assets/brand by scripts/brand/export.mjs.
 *
 * Before the brand kit, apps/web/.env set a text logo ("🛍️ Storybook" in
 * Quicksand), so neither PNG was ever shown. The guard asserts the image
 * logo is the one on screen, in each theme, and that it actually loaded.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

type Theme = 'light' | 'dark';

async function openAs(page: Page, path: string, theme: Theme) {
  const url = new URL(
    process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
  );

  await page
    .context()
    .addCookies([
      { name: 'theme', value: theme, domain: url.hostname, path: '/' },
    ]);
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(path);
}

async function expectLogoLoaded(page: Page, theme: Theme) {
  const shown = byTest(page, `app-logo-${theme}`).first();
  const other = theme === 'light' ? 'dark' : 'light';

  await expect(shown).toBeVisible();
  // the other theme's logo is in the DOM but never on screen
  await expect(byTest(page, `app-logo-${other}`)).toHaveCount(0);
  await expect(shown).toHaveAttribute('alt', 'StoryBook');
  await expect(shown).toHaveAttribute('src', new RegExp(`logo-${theme}\\.png`));
  await expect
    .poll(() =>
      shown.evaluate((img: HTMLImageElement) =>
        img.complete ? img.naturalWidth : 0,
      ),
    )
    .toBeGreaterThan(0);

  return shown;
}

test.describe('StoryBook brand in the web app', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`the ${theme} header shows the brand lockup image`, async ({
      page,
    }) => {
      await openAs(page, '/auth/sign-in', theme);
      await expectLogoLoaded(page, theme);
    });
  }

  test('the favicon is the brand monogram', async ({ request }) => {
    const ico = await request.get('/images/favicon/favicon.ico');

    expect(ico.status()).toBe(200);

    // A PNG-in-ICO with 16, 32 and 48 px entries (scripts/brand/export.mjs).
    const body = await ico.body();

    expect(body.readUInt16LE(2)).toBe(1);
    expect(body.readUInt16LE(4)).toBe(3);
  });
});

test.describe('StoryBook brand in the web app — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  for (const theme of ['light', 'dark'] as const) {
    test(`captures the marketing header and sign-in page, ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });

      await openAs(page, '/', theme);
      await expectLogoLoaded(page, theme);
      await page.screenshot({
        path: `${OUT}/web-home-${theme}.png`,
        clip: { x: 0, y: 0, width: 1280, height: 360 },
      });

      await openAs(page, '/auth/sign-in', theme);
      await expectLogoLoaded(page, theme);
      await page.waitForFunction(() =>
        document.getAnimations().every((a) => a.playState !== 'running'),
      );
      await page.screenshot({ path: `${OUT}/web-sign-in-${theme}.png` });
    });
  }
});
