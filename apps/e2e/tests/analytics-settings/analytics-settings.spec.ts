import { expect, test } from '@playwright/test';

import { AnalyticsSettingsPageObject } from './analytics-settings.po';

/**
 * Analytics settings (FILM-1608).
 *
 * `analytics_settings` shipped with two readers and zero writers, so until
 * this page existed its three values were constants wearing a table's
 * clothing. The interesting behaviour is not "a number saves" — it is that a
 * *blank* field saves, as null, and comes back blank.
 *
 * That round trip is the whole feature: null is how a channel says "follow
 * the account" and how an account says "use the shipped default". A field
 * that quietly stores 0 or the default instead is indistinguishable from a
 * working one until someone tries to remove an override.
 */
test.describe('Analytics settings', () => {
  test('saves account defaults', async ({ page }) => {
    const settings = new AnalyticsSettingsPageObject(page);

    await settings.setup();

    await settings.accountWatchHours().fill('3500');
    await settings.accountSubscribers().fill('900');
    await settings.saveAccount();

    await expect(settings.accountSavedSummary()).toContainText('watch hours');
  });

  test('a blank target is accepted and means inherit', async ({ page }) => {
    const settings = new AnalyticsSettingsPageObject(page);

    const account = await settings.setup();

    // Nothing filled in at all. The schema takes `null`, not `undefined` and
    // not 0 — if blank were being coerced to a number this would either be
    // rejected on a field the user never touched, or saved as a real target.
    await settings.saveAccount();

    await expect(settings.accountSavedSummary()).toContainText(
      'All three using defaults',
    );

    await settings.goToSettings(account.slug);

    await expect(settings.accountWatchHours()).toHaveValue('');
  });

  test('clearing a channel override stores null, not zero', async ({ page }) => {
    const settings = new AnalyticsSettingsPageObject(page);

    const account = await settings.setup();

    await settings.channelWatchHours().fill('8000');
    await settings.saveChannel();

    // The second submission. After `form.reset()` the inputs hold their own
    // display text, so a reset that only touched form state would leave
    // `8000` on screen while the form believed otherwise — and the next save
    // would write a value nobody typed.
    await settings.channelWatchHours().fill('');
    await settings.saveChannel();

    await expect(settings.channelWatchHours()).toHaveValue('');

    // Round-tripped through Postgres rather than read back off the form, so
    // a value that never left the browser cannot make this pass.
    await settings.goToSettings(account.slug);

    await expect(settings.channelWatchHours()).toHaveValue('');
  });

  test('a channel override survives a reload', async ({ page }) => {
    const settings = new AnalyticsSettingsPageObject(page);

    const account = await settings.setup();

    await settings.channelWatchHours().fill('6500');
    await settings.channelSubscribers().fill('1200');
    await settings.saveChannel();

    await settings.goToSettings(account.slug);

    await expect(settings.channelWatchHours()).toHaveValue('6500');
    await expect(settings.channelSubscribers()).toHaveValue('1200');
  });

  test('the applicant status keeps its saved value across a reload', async ({
    page,
  }) => {
    const settings = new AnalyticsSettingsPageObject(page);

    const account = await settings.setup();

    await settings.chooseStatus('Already a partner');
    await settings.saveChannel();

    // Radix owns the trigger's displayed label when the Select is
    // uncontrolled, so this is where a stale label would show: the saved
    // value says one thing and the trigger another.
    await expect(settings.channelStatusTrigger()).toContainText(
      'Already a partner',
    );

    await settings.goToSettings(account.slug);

    await expect(settings.channelStatusTrigger()).toContainText(
      'Already a partner',
    );
  });

  test('refuses a pasted thousands separator instead of storing part of it', async ({
    page,
  }) => {
    const settings = new AnalyticsSettingsPageObject(page);

    await settings.setup();

    // `Number.parseInt('1,250', 10)` is 1. In FILM-1609 that exact shape
    // turned a pasted figure into $1.00 and overwrote a real one, so here
    // the parse refuses rather than taking the prefix.
    await settings.accountWatchHours().fill('1,250');

    // The text stays as typed — snapping the box to `0` would lose what the
    // user pasted, which is the same defect pointing the other way.
    await expect(settings.accountWatchHours()).toHaveValue('1,250');

    await settings.accountSubmit().click();

    await expect(
      page.getByText(
        'Enter a whole number greater than zero, or leave blank to inherit',
      ),
    ).toBeVisible();
  });
});
