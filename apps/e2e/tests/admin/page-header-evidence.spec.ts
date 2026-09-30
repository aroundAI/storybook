import { expect, test } from '@playwright/test';

import { SUPER_ADMIN_STORAGE_STATE } from '../utils/super-admin';

/**
 * The admin caller of PageHeader with its description under the title
 * (FILM-208). Not a guard. Skipped unless CAPTURE_EVIDENCE is set.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('PageHeader description order — admin evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('captures the admin dashboard header', async ({ page }) => {
    await page.goto('/admin');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.screenshot({ path: `${OUT}/page-header-admin.png` });
  });
});
