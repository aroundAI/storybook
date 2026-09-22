import { expect, test } from '@playwright/test';

import { PRODUCTION_SENTENCE, SCENARIOS, refusalToast } from './refusals.po';

/**
 * KB-6: a refusal a server action raises on purpose must reach the user as
 * written.
 *
 * These only mean something on a production build, which is what ⚫️ Test
 * serves. A production build replaces the message of an error *thrown* from
 * a server action with "An error occurred in the Server Components render…";
 * a dev server passes the real text through. So on a dev server every test
 * here passes with the fix removed — a dev-server green proves nothing, and
 * a dev-server red is not possible.
 *
 * The wording, not only that something appeared: an assertion that an error
 * is visible passes on the generic sentence too, which is how this survived.
 */
test.describe('Server-action refusals reach the page as written', () => {
  for (const scenario of SCENARIOS) {
    test(`${scenario.area}: ${scenario.name}`, async ({ page }) => {
      await scenario.run(page);

      const toast = refusalToast(page);

      await expect(toast).toContainText(scenario.message);
      await expect(toast).not.toContainText(PRODUCTION_SENTENCE);
    });
  }
});
