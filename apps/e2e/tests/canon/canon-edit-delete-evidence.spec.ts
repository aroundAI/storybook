import { expect, test } from '@playwright/test';

import { byTest } from '../utils/visible';
import { type CanonFixture, openStoryCanon, seedCanon } from './canon-fixture';

/**
 * Screenshots for the canon edit and delete dialogs (FILM-1007). Not a
 * guard -- `canon-edit-delete.spec.ts` holds those. Skipped unless
 * CAPTURE_EVIDENCE is set, so it costs CI nothing.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

let canon: CanonFixture;

test.describe('Canon edit and delete dialogs -- evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test.beforeAll(async () => {
    canon = await seedCanon('canon-edit-ev');
  });

  test('captures each dialog, and the list after the action', async ({
    page,
  }) => {
    await openStoryCanon(page, canon);

    await byTest(page, 'canon-event-delete').click();
    await page.screenshot({ path: `${OUT}/01-delete-event-confirm.png` });
    await page.getByRole('button', { name: 'Cancel' }).click();

    await byTest(page, 'canon-threads-tab').click();
    await byTest(page, 'canon-thread-edit').click();
    await byTest(page, 'canon-thread-status').click();
    await page.getByRole('option', { name: 'Resolved' }).click();
    await byTest(page, 'canon-thread-payoffs').fill('The key was in the lamp');
    await page.screenshot({ path: `${OUT}/02-edit-thread.png` });
    await byTest(page, 'canon-thread-edit-submit').click();
    await expect(byTest(page, 'canon-thread')).toHaveCount(0);
    await page.screenshot({ path: `${OUT}/03-thread-list-after-save.png` });

    await byTest(page, 'canon-characters-tab').click();
    await byTest(page, 'canon-character-state-edit').first().click();
    await byTest(page, 'canon-character-state-submit').click();
    await page.screenshot({ path: `${OUT}/04-character-state-validation.png` });
    await byTest(page, 'canon-character-state-value').fill('grieving');
    await byTest(page, 'canon-character-state-trigger').fill('Ilya is found');
    await byTest(page, 'canon-character-state-submit').click();
    await expect(byTest(page, 'canon-character-state-value')).toHaveCount(0);
    await page.screenshot({ path: `${OUT}/05-characters-after-save.png` });
  });
});
