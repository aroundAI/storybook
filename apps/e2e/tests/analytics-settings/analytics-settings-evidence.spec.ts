import { test } from '@playwright/test';

import { AnalyticsSettingsPageObject } from './analytics-settings.po';

/**
 * Screenshots for the PR (FILM-1608).
 *
 * Not a guard — `analytics-settings.spec.ts` holds those. This exists to
 * produce evidence a reviewer can look at, because the states that matter
 * here are the ones *after* an action: a form that looks right on load and
 * wrong after a save is the defect this feature is most likely to have.
 *
 * Skipped unless CAPTURE_EVIDENCE is set, so CI pays nothing for it.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('Analytics settings — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('captures the settings states', async ({ page }) => {
    const settings = new AnalyticsSettingsPageObject(page);

    const account = await settings.setup();

    await page.screenshot({
      path: `${OUT}/01-defaults.png`,
      fullPage: true,
    });

    // The validation state. A message that never renders is indistinguishable
    // from one that does, in a diff.
    await settings.accountWatchHours().fill('1,250');
    await settings.accountSubmit().click();
    await page
      .getByText('Enter a whole number greater than zero, or leave blank to inherit')
      .waitFor();

    await page.screenshot({
      path: `${OUT}/02-rejects-separator.png`,
      fullPage: true,
    });

    await settings.accountWatchHours().fill('3500');
    await settings.accountSubscribers().fill('900');
    await settings.saveAccount();

    await page.screenshot({
      path: `${OUT}/03-account-saved.png`,
      fullPage: true,
    });

    await settings.channelWatchHours().fill('8000');
    await settings.chooseStatus('New applicant');
    await settings.saveChannel();

    await page.screenshot({
      path: `${OUT}/04-channel-override.png`,
      fullPage: true,
    });

    // A downward override while the status is Unknown. The save succeeds and
    // the value round-trips, but the over-state rule means the account's
    // figure is what actually gets used — so the form says so rather than
    // letting the page look like it worked.
    await settings.chooseStatus('Unknown');
    await settings.channelWatchHours().fill('1200');
    await page.locator('[data-test="channel-overridden-notice"]').waitFor();

    await page.screenshot({
      path: `${OUT}/05-lower-override-notice.png`,
      fullPage: true,
    });

    // The second submission — clearing an override. This is the state that
    // would look identical to a working one in a screenshot taken before the
    // action, and different in the one taken after.
    await settings.channelWatchHours().fill('');
    await settings.saveChannel();
    await settings.goToSettings(account.slug);

    await page.screenshot({
      path: `${OUT}/06-override-cleared.png`,
      fullPage: true,
    });

    // Read the values back out of the DOM so the PR comment can quote
    // numbers rather than adjectives. "Looks right" is not a claim a
    // reviewer can check.
    const measured = await page.evaluate(() => {
      const read = (test: string) => {
        const el = document.querySelector<HTMLInputElement>(
          `[data-test="${test}"]`,
        );

        return el === null ? null : { value: el.value, type: el.type };
      };

      return {
        accountWatchHours: read('account-watch-hours-input'),
        accountSubscribers: read('account-subscribers-input'),
        accountTagMinSample: read('account-tag-min-sample-input'),
        channelWatchHours: read('channel-watch-hours-input'),
        channelSubscribers: read('channel-subscribers-input'),
        channelStatus: document
          .querySelector('[data-test="channel-status-trigger"]')
          ?.textContent?.trim(),
      };
    });

    console.log('MEASURED', JSON.stringify(measured, null, 2));
  });
});
