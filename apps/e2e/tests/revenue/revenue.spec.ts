import { expect, test } from '@playwright/test';

import { RevenuePageObject } from './revenue.po';

/**
 * Manual revenue entry (FILM-1609).
 *
 * Licensing income has no API on any platform and is manual entry
 * permanently, so this form is the only way that category can ever be
 * recorded. It was unsubmittable in three distinct ways across three
 * review rounds — and every one of them passed typecheck, lint and the
 * unit suite. What they had in common is that they lived between the DOM
 * and form state, where only a browser can see them.
 */
test.describe('Manual revenue entry', () => {
  test('records a licensing entry', async ({ page }) => {
    const revenue = new RevenuePageObject(page);

    await revenue.setup();

    await revenue.addEntry({ dollars: '250.00', category: 'Licensing' });

    // That this succeeds at all is the point: for three rounds it did not.
    // First an empty-string publishId failed uuid validation, then a
    // missing accountId failed the scope refinement — both reported as an
    // error on a field the user never touched.
    await revenue.expectSuccessToast();
  });

  test('records channel-level revenue without a video', async ({ page }) => {
    const revenue = new RevenuePageObject(page);

    await revenue.setup();

    // The dashboard mounts this form with no publishes, so "Whole channel"
    // is the only selectable scope. The schema always allowed it; the UI
    // could not reach it.
    await expect(revenue.publishTrigger()).toContainText('Whole channel');

    await revenue.addEntry({ dollars: '80.00', category: 'Sponsorship' });

    await revenue.expectSuccessToast();
  });

  test('clears the amount after saving, so the next entry is not a silent zero', async ({
    page,
  }) => {
    const revenue = new RevenuePageObject(page);

    await revenue.setup();

    await revenue.addEntry({ dollars: '250.00', category: 'Licensing' });
    await revenue.expectSuccessToast();

    // The Amount input was never registered with react-hook-form, so
    // form.reset() zeroed revenueCents while the DOM kept showing 250.00.
    // Submitting again wrote a revenue_cents = 0 row — accepted by the
    // schema, reported as success — over a real figure.
    await expect(revenue.amountInput()).toHaveValue('');
  });

  test('resets the currency after saving rather than keeping the last choice', async ({
    page,
  }) => {
    const revenue = new RevenuePageObject(page);

    await revenue.setup();

    await revenue.chooseCurrency('EUR - Euro');
    await expect(revenue.currencyTrigger()).toContainText('EUR');

    await revenue.addEntry({ dollars: '40.00', category: 'Licensing' });
    await revenue.expectSuccessToast();

    // An uncontrolled Select keeps its displayed value across reset, so
    // the next entry saves as USD while the form reads EUR.
    await expect(revenue.currencyTrigger()).toContainText('USD');
  });

  test('resets the category after saving', async ({ page }) => {
    const revenue = new RevenuePageObject(page);

    await revenue.setup();

    await revenue.addEntry({ dollars: '15.00', category: 'Licensing' });
    await revenue.expectSuccessToast();

    await expect(revenue.categoryTrigger()).toContainText('Sponsorship');
  });

  test('refuses a blank amount instead of saving zero', async ({ page }) => {
    const revenue = new RevenuePageObject(page);

    await revenue.setup();

    await revenue.pickToday();
    await revenue.chooseCategory('Licensing');
    await revenue.submit();

    // revenueCents was `.min(0)`, so a blank amount was a valid zero — and
    // because one entry per date and category replaces the previous one,
    // that zero would overwrite a real amount and report success.
    await expect(
      page.getByText(/Enter an amount greater than zero/),
    ).toBeVisible();
  });

  test('keeps a mid-edit amount visible rather than silently zeroing it', async ({
    page,
  }) => {
    const revenue = new RevenuePageObject(page);

    await revenue.setup();

    // `<input type="number">` hands back '' for a value like this, so the
    // field displayed 12. while form state held 0, and React rewrote
    // nothing because both sides were ''.
    await revenue.fillAmount('12.');

    await expect(revenue.amountInput()).toHaveValue('12.');

    await revenue.pickToday();
    await revenue.chooseCategory('Licensing');
    await revenue.submit();

    await revenue.expectSuccessToast();
  });

  test('refuses a pasted thousands separator rather than saving its prefix', async ({
    page,
  }) => {
    const revenue = new RevenuePageObject(page);

    await revenue.setup();

    // Straight out of a spreadsheet. parseFloat reads this as 1, which
    // passes validation, submits, reports success, and — because one entry
    // per date and category replaces the previous — overwrites a real
    // figure with $1.00 while the field still reads 1,250.00.
    await revenue.fillAmount('1,250.00');
    await revenue.pickToday();
    await revenue.chooseCategory('Licensing');
    await revenue.submit();

    // The figure is refused, not read as $1.00 and saved.
    await expect(
      page.getByText(/Enter an amount greater than zero/),
    ).toBeVisible();
    await expect(
      page.getByText('Revenue entry added successfully'),
    ).toBeHidden();
  });

  test('clearing the date clears it, rather than submitting the old one', async ({
    page,
  }) => {
    const revenue = new RevenuePageObject(page);

    await revenue.setup();

    await revenue.pickToday();
    await expect(revenue.dateTrigger()).not.toContainText('Pick a date');

    // react-day-picker toggles: clicking the selected day deselects it.
    // A one-way useEffect ignored that, so the calendar showed nothing
    // selected while the entry still submitted under the old date.
    await revenue.pickToday();

    await expect(revenue.dateTrigger()).toContainText('Pick a date');
  });

  test('shows the day that was clicked, in the local zone', async ({
    page,
  }) => {
    const revenue = new RevenuePageObject(page);

    await revenue.setup();
    await revenue.pickToday();

    // `new Date('2026-09-14')` is UTC midnight, so west of UTC the trigger
    // rendered the previous day while the calendar highlighted the right
    // one and the row saved the right date.
    await expect(revenue.dateTrigger()).toHaveText(
      await revenue.expectedDateText(),
    );
  });

  test('offers every category the schema accepts', async ({ page }) => {
    const revenue = new RevenuePageObject(page);

    await revenue.setup();

    await revenue.categoryTrigger().click();

    // The vocabulary lived in three places before FILM-1609. These are the
    // seven the database CHECK accepts.
    for (const label of [
      'Sponsorship',
      'Product sales',
      'Affiliate',
      'Licensing',
      'Ads',
      'Premium',
      'Other',
    ]) {
      await expect(
        page.getByRole('option', { name: label, exact: true }),
      ).toBeVisible();
    }
  });
});

/**
 * The date field, with the browser west of UTC.
 *
 * CI runs UTC, where every date bug in this form is invisible: a
 * `yyyy-MM-dd` parsed as UTC midnight renders as the previous day only
 * when the viewer is behind UTC. Pinning the zone is the only way this
 * class is ever caught before a user in California finds it.
 */
test.describe('Manual revenue entry — west of UTC', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('shows the day that was clicked, not the day before', async ({
    page,
  }) => {
    const revenue = new RevenuePageObject(page);

    await revenue.setup();
    await revenue.pickToday();

    // The whole rendered string, not the day number: "September 2nd, 2026"
    // contains "2", so a bare-number assertion passes on the 2nd, 6th,
    // 20th and 26th even when the trigger shows the wrong day — blind on
    // four days a month, which is where a regression would hide.
    await expect(revenue.dateTrigger()).toHaveText(
      await revenue.expectedDateText(),
    );
  });

  test('picks today rather than a disabled tomorrow', async ({ page }) => {
    // The page object built its selector from toISOString() once, which
    // west of UTC after ~17:00 targets tomorrow — a cell that exists but
    // is disabled, so the click waits out the whole test timeout.
    const revenue = new RevenuePageObject(page);

    await revenue.setup();
    await revenue.addEntry({ dollars: '10.00', category: 'Licensing' });

    await revenue.expectSuccessToast();
  });
});
