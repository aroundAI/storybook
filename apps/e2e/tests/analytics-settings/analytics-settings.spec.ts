import { expect, test } from '@playwright/test';

import { seedChannelSettings } from '../utils/seed';
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

  test('a blank account target is stored as inherit, not as a number', async ({
    page,
  }) => {
    const settings = new AnalyticsSettingsPageObject(page);

    const account = await settings.setup();

    // A value is set first, deliberately. The first draft of this test saved
    // a blank form on a freshly seeded account and asserted the fields were
    // blank — both true *before* the save, so it stayed green whether or not
    // the save did anything at all. Clearing something that was really there
    // is the only version of this that can fail.
    await settings.accountWatchHours().fill('3500');
    await settings.accountSubscribers().fill('900');
    await settings.saveAccount();

    await settings.goToSettings(account.slug);
    await expect(settings.accountWatchHours()).toHaveValue('3500');

    await settings.accountWatchHours().fill('');
    await settings.accountSubscribers().fill('');
    await settings.saveAccount();

    await expect(settings.accountSavedSummary()).toContainText(
      'All three using defaults',
    );

    // Round-tripped through Postgres: a blank must come back as null, not as
    // 0 and not as the default written into the column.
    await settings.goToSettings(account.slug);

    await expect(settings.accountWatchHours()).toHaveValue('');
    await expect(settings.accountSubscribers()).toHaveValue('');
  });

  test('clearing a channel override stores null, not zero', async ({
    page,
  }) => {
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

    // The resolver can only move focus to a field it holds a ref for. Without
    // one, focus stays on the button and, below the fold, the error is never
    // seen.
    await expect(settings.accountWatchHours()).toBeFocused();
  });

  test('no override notice when the account has set nothing', async ({
    page,
  }) => {
    const settings = new AnalyticsSettingsPageObject(page);

    await settings.setup();

    // A fresh account, nothing saved at the account level — the state every
    // account was in, because this table had no writer before FILM-1608.
    //
    // The first version of the notice compared against the shipped default
    // and announced that this override would be ignored. It will not be:
    // `resolveOne` escalates only when *both* levels hold a value, so 1,200
    // is the target. The warning told people to change a status they had no
    // reason to change.
    await settings.chooseStatus('Unknown');
    await settings.channelWatchHours().fill('1200');

    await expect(
      page.locator('[data-test="channel-overridden-notice"]'),
    ).toHaveCount(0);
  });

  test('no override notice for text the field cannot parse', async ({
    page,
  }) => {
    const settings = new AnalyticsSettingsPageObject(page);

    await settings.setup();

    await settings.accountWatchHours().fill('4000');
    await settings.saveAccount();

    // The number field writes 0 for unparseable text so the schema's
    // `.positive()` renders a message. That sentinel reached the notice and
    // produced "the target 0 will not be used" beside the field's own error.
    await settings.chooseStatus('Unknown');
    await settings.channelWatchHours().fill('1,2');

    await expect(
      page.locator('[data-test="channel-overridden-notice"]'),
    ).toHaveCount(0);

    // Submitted, because react-hook-form only surfaces validation on submit —
    // the first draft of this case asserted the message without submitting
    // and failed on its own assertion rather than on the behaviour.
    await settings.channelSubmit().click();

    await expect(
      page
        .getByText(
          'Enter a whole number greater than zero, or leave blank to inherit',
        )
        .first(),
    ).toBeVisible();

    // Still silent after the failed submit: 0 is a parse sentinel, not a
    // target anyone chose.
    await expect(
      page.locator('[data-test="channel-overridden-notice"]'),
    ).toHaveCount(0);
  });

  test('the override notice quotes the account value just saved, not the one from page load', async ({
    page,
  }) => {
    const settings = new AnalyticsSettingsPageObject(page);

    await settings.setup();

    // Save a new account default without reloading, then look at a channel.
    // The channel card is server-rendered with the account's figures, so
    // before `router.refresh()` the notice went on quoting the value from
    // page load — a screenshot caught it saying "lower than the account's
    // 4,000" directly beneath a field reading 3,500. Nothing asserted that
    // number, which is exactly why the screenshot rule exists.
    await settings.accountWatchHours().fill('3500');
    await settings.saveAccount();

    await settings.chooseStatus('Unknown');
    await settings.channelWatchHours().fill('1200');

    const notice = page.locator('[data-test="channel-overridden-notice"]');

    await expect(notice).toBeVisible();
    // The resolved target, read off `resolveYppTarget` rather than
    // recomputed here, so this cannot drift from the rule again.
    await expect(notice).toContainText('3,500');
    await expect(notice).not.toContainText('4,000');
  });

  test('refuses a joined date that has not happened yet', async ({ page }) => {
    const settings = new AnalyticsSettingsPageObject(page);

    const account = await settings.setup();

    // A week ahead: past the one day of slack the schema allows for users
    // ahead of UTC. Typed rather than picked — the input's `max` stops the
    // picker, not a typed value.
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 7);
    const futureIso = future.toISOString().slice(0, 10);

    // `max` has to be on the element before anything is typed. Without this
    // wait the fill can land on server-rendered markup that React then
    // replaces, leaving a value the browser never range-checks — which is how
    // this flaked in CI, with `rangeOverflow` false for the full 10s.
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() + 1);

    await expect(settings.channelJoined()).toHaveAttribute(
      'max',
      cutoff.toISOString().slice(0, 10),
    );

    await settings.channelJoined().fill(futureIso);
    await expect(settings.channelJoined()).toHaveValue(futureIso);

    await settings.channelSubmit().click();

    // The input's `max` makes the browser refuse the submission before the
    // form's schema sees it, so the refusal to assert is the native one; the
    // schema's own message is the backstop for anything that bypasses the
    // input, and is covered by the unit tests.
    await expect
      .poll(() =>
        settings
          .channelJoined()
          .evaluate((input: HTMLInputElement) => input.validity.rangeOverflow),
      )
      .toBe(true);

    await expect(page.getByText(/Saved settings for/)).toHaveCount(0);

    // And nothing was written: after a reload the field is still empty.
    await settings.goToSettings(account.slug);

    await expect(settings.channelJoined()).toHaveValue('');
  });

  test('the joined date input allows exactly what the schema allows', async ({
    page,
  }) => {
    const settings = new AnalyticsSettingsPageObject(page);

    await settings.setup();

    // Tomorrow in UTC: the schema's bound, because a user ahead of UTC is
    // already on their local today. The input used the *browser's* today,
    // a third bound — so a user behind UTC could pick a date the schema
    // refuses, or be refused one it accepts.
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    await expect(settings.channelJoined()).toHaveAttribute(
      'max',
      tomorrow.toISOString().slice(0, 10),
    );
  });

  test('a stored future joined date does not block the rest of its card', async ({
    page,
  }) => {
    const settings = new AnalyticsSettingsPageObject(page);

    const account = await settings.setup();

    // `ypp-targets.ts` expects rows written before the form refused future
    // dates. Such a row must not lock every other setting on the card: the
    // date cannot be *entered* any more, but one already stored can be left
    // alone while the targets are saved.
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 7);
    const futureIso = future.toISOString().slice(0, 10);

    await seedChannelSettings(account.connectionId, account.accountId, {
      joined_ypp_at: futureIso,
    });

    await settings.goToSettings(account.slug);

    await expect(settings.channelJoined()).toHaveValue(futureIso);

    await settings.channelWatchHours().fill('7000');
    await settings.saveChannel();

    await settings.goToSettings(account.slug);

    await expect(settings.channelWatchHours()).toHaveValue('7000');
    await expect(settings.channelJoined()).toHaveValue(futureIso);
  });
});
