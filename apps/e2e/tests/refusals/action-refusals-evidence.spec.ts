import { expect, test } from '@playwright/test';

import { SCENARIOS, refusalToast } from './refusals.po';

/**
 * Screenshots of what a user reads when a server action refuses (KB-6).
 *
 * Not a guard — `action-refusals.spec.ts` holds those. Run it against a
 * **production** build: a dev server shows the right text with or without
 * the fix. The screenshot is taken before the wording is asserted, so a run
 * against an unfixed build still leaves the "before" picture behind it.
 *
 * Skipped unless CAPTURE_EVIDENCE is set, so it costs ⚫️ Test nothing.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('Server-action refusals — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  for (const [index, scenario] of SCENARIOS.entries()) {
    test(`${scenario.area}: ${scenario.name}`, async ({ page }, testInfo) => {
      await scenario.run(page);

      const toast = refusalToast(page);

      await expect(toast).toBeVisible();

      const shown = (await toast.innerText()).replace(/\s+/g, ' ').trim();

      await page.screenshot({
        path: `${OUT}/${String(index + 1).padStart(2, '0')}-${scenario.area}.png`,
      });

      // Measured, not eyeballed — the text quoted in the PR comment.
      await testInfo.attach(`${scenario.area}-toast-text`, {
        body: shown,
        contentType: 'text/plain',
      });
      console.log(`[kb-6 evidence] ${scenario.area}: ${shown}`);

      await expect(toast).toContainText(scenario.message);
    });
  }
});
