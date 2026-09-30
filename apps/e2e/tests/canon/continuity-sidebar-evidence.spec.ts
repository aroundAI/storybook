import { expect, test } from '@playwright/test';

import { byTest } from '../utils/visible';
import { type CanonFixture, openScreenplay, seedCanon } from './canon-fixture';

/**
 * Screenshots and DOM measurements for the Continuity Sidebar (FILM-1007).
 * Not a guard -- `continuity-sidebar.spec.ts` holds those. Skipped unless
 * CAPTURE_EVIDENCE is set, so it costs CI nothing.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

/** Raw on purpose: byTest() drops hidden matches, and these assert hidden. */
const HIDDEN_SIDEBAR = '[data-test="continuity-sidebar"]';

let canon: CanonFixture;

test.describe('Continuity Sidebar -- evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test.beforeAll(async () => {
    canon = await seedCanon('canon-continuity-ev');
  });

  test('captures scene 1, scene 2 with a violation, and the narrow viewport', async ({
    page,
  }) => {
    const measured: Array<Record<string, unknown>> = [];

    await page.setViewportSize({ width: 1440, height: 900 });
    await openScreenplay(page, canon);
    const sidebar = byTest(page, 'continuity-sidebar');
    await expect(byTest(sidebar, 'continuity-event')).toBeVisible();
    await page.screenshot({ path: `${OUT}/01-scene-1-wide.png` });
    measured.push({
      state: 'scene 1, 1440px',
      sidebarWidth: (await sidebar.boundingBox())?.width,
      events: await byTest(sidebar, 'continuity-event').count(),
      threads: await byTest(sidebar, 'continuity-thread').count(),
      characters: await byTest(sidebar, 'continuity-character').count(),
    });

    await byTest(page, 'scene-index-item-2').click();
    await expect(byTest(page, 'continuity-violation')).toBeVisible();
    await page.screenshot({ path: `${OUT}/02-scene-2-violation.png` });
    measured.push({
      state: 'scene 2, 1440px',
      violations: await byTest(
        sidebar,
        'continuity-violation',
      ).allTextContents(),
    });

    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.locator(HIDDEN_SIDEBAR)).toBeHidden();
    await page.screenshot({ path: `${OUT}/03-narrow-hidden.png` });
    measured.push({
      state: '800px',
      sidebarDisplay: await page
        .locator(HIDDEN_SIDEBAR)
        .evaluate((el) => getComputedStyle(el).display),
    });

    console.log(`FILM-1007 measured:\n${JSON.stringify(measured, null, 2)}`);
  });
});
