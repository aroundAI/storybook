import { expect, test } from '@playwright/test';

import { byTest } from '../utils/visible';
import { RevenuePageObject } from './revenue.po';

/**
 * Screenshots and DOM measurements for the manual revenue form.
 *
 * Not a guard — `revenue.spec.ts` holds those. This exists to produce
 * evidence a reviewer can look at, and to measure the claims in the DOM
 * rather than by eye. Skipped unless CAPTURE_EVIDENCE is set, so it costs
 * CI nothing.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('Manual revenue entry — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('captures the states the review rounds argued about', async ({
    page,
  }) => {
    const revenue = new RevenuePageObject(page);

    await revenue.setup();

    const form = byTest(page, 'manual-revenue-form');

    // 1. The form as it opens. "Whole channel" is the default scope, and
    //    reaching it at all is what two review rounds failed to do.
    await expect(revenue.publishTrigger()).toContainText('Whole channel');
    await form.screenshot({ path: `${OUT}/01-empty-form.png` });

    // 2. Blank amount is refused rather than saved as zero.
    await revenue.pickToday();
    await revenue.chooseCategory('Licensing');
    await revenue.submit();

    const amountError = page.getByText('Enter an amount greater than zero');

    await expect(amountError).toBeVisible();
    await form.screenshot({ path: `${OUT}/02-blank-amount-refused.png` });

    // 3. A filled entry, licensing selected.
    await revenue.fillAmount('250.00');

    await expect(revenue.categoryTrigger()).toContainText('Licensing');
    await form.screenshot({ path: `${OUT}/03-filled-licensing.png` });

    await revenue.submit();
    await revenue.expectSuccessToast();

    // 4. After saving: every field back to its default. Each of these was
    //    a shipped bug — the amount kept its text while state read zero,
    //    and the selects kept their labels while state had reset.
    await expect(revenue.amountInput()).toHaveValue('');
    await expect(revenue.categoryTrigger()).toContainText('Sponsorship');
    await expect(revenue.currencyTrigger()).toContainText('USD');
    await expect(revenue.publishTrigger()).toContainText('Whole channel');

    await form.screenshot({ path: `${OUT}/04-reset-after-save.png` });

    // Measured, not eyeballed — the numbers quoted in the PR comment.
    const measured = await page.evaluate(() => {
      const value = (sel: string) =>
        (document.querySelector(sel) as HTMLInputElement | null)?.value ?? null;
      const text = (sel: string) =>
        document.querySelector(sel)?.textContent?.trim() ?? null;

      return {
        amountAfterSave: value('[data-test="revenue-amount-input"]'),
        amountInputType: (
          document.querySelector(
            '[data-test="revenue-amount-input"]',
          ) as HTMLInputElement | null
        )?.type,
        categoryAfterSave: text('[data-test="revenue-category-trigger"]'),
        currencyAfterSave: text('[data-test="revenue-currency-trigger"]'),
        publishAfterSave: text('[data-test="revenue-publish-trigger"]'),
        replacementDisclosed: /replaces/i.test(
          document.querySelector('[data-test="manual-revenue-form"]')
            ?.textContent ?? '',
        ),
      };
    });

    console.log('MEASURED', JSON.stringify(measured, null, 2));

    expect(measured.amountAfterSave).toBe('');
    // text, not number: a number input hands back '' for a mid-edit '12.'
    expect(measured.amountInputType).toBe('text');
    expect(measured.replacementDisclosed).toBe(true);
  });

  test('captures a mid-edit amount surviving as typed', async ({ page }) => {
    const revenue = new RevenuePageObject(page);

    await revenue.setup();

    await revenue.fillAmount('12.');

    // The state that used to display 12. while form state held 0.
    await expect(revenue.amountInput()).toHaveValue('12.');

    await page
      .locator('[data-test="manual-revenue-form"]')
      .screenshot({ path: `${OUT}/05-mid-edit-amount.png` });
  });
});
