import { expect, test } from '@playwright/test';

import { byTest } from '../utils/visible';
import { type CanonFixture, openScreenplay, seedCanon } from './canon-fixture';

/**
 * FILM-1007: the screenplay page shows the scene's canon constraints in a
 * Continuity Sidebar, and hides it below the `lg` breakpoint (1024px).
 */

let canon: CanonFixture;

test.beforeAll(async () => {
  canon = await seedCanon('canon-continuity');
});

test.describe('Continuity Sidebar (FILM-1007)', () => {
  test('shows what the scene must not contradict, the open threads and the characters', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openScreenplay(page, canon);

    const sidebar = byTest(page, 'continuity-sidebar');
    await expect(sidebar).toBeVisible();

    await expect(byTest(sidebar, 'continuity-event')).toContainText(
      'Ilya died in the flood of the lower harbour.',
    );
    await expect(byTest(sidebar, 'continuity-thread')).toContainText(
      'The missing key',
    );
    // Scene 1 names Mara.
    await expect(byTest(sidebar, 'continuity-character')).toContainText('Mara');
    await expect(byTest(sidebar, 'continuity-character')).toContainText(
      'emotional: calm',
    );
  });

  test('flags the dead character shown alive in the scene being read', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openScreenplay(page, canon);

    // Scene 2 has Ilya walking the pier.
    await byTest(page, 'scene-index-item-2').click();

    await expect(byTest(page, 'continuity-violation')).toContainText(
      'CANON_001',
    );
  });

  test('is hidden below the lg breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await openScreenplay(page, canon);

    await expect(
      page.getByText('Screenplay', { exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator('[data-test="continuity-sidebar"]')).toBeHidden();
  });
});
