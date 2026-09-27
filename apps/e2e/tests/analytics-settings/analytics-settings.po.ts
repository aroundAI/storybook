import { Page, expect } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { seedTeamAccount, seedYouTubeConnection } from '../utils/seed';
import { waitForSignedIn } from '../utils/session';

/**
 * The analytics settings page (FILM-1608).
 *
 * The fields here are nullable integers where **blank means inherit**, which
 * is a state the repo's existing numeric inputs cannot express — the
 * prevailing idiom is `parseInt(value, 10) || <default>`, so a cleared field
 * silently becomes a number. That defect is invisible to a unit test: the
 * resolver is correct in isolation, and only the DOM can show a field that
 * says one thing while form state holds another.
 *
 * It appears on the *second* submission, after a reset, which is why these
 * tests save twice and reload.
 */
export class AnalyticsSettingsPageObject {
  private readonly page: Page;
  public auth: AuthPageObject;

  constructor(page: Page) {
    this.page = page;
    this.auth = new AuthPageObject(page);
  }

  /**
   * Seeds a confirmed user, a team account and one active YouTube channel,
   * signs in, and lands on the settings page.
   *
   * Through the API, like the revenue suite: sign-up, confirmation mail and
   * the account selector are three flows deep before this test can start,
   * they have their own specs, and a failure in them would read as a broken
   * settings test.
   */
  async setup() {
    const account = await seedTeamAccount();
    const connectionId = await seedYouTubeConnection(
      account.accountId,
      'Seeded Channel',
    );

    await this.auth.goToSignIn();

    await this.auth.signIn({
      email: account.email,
      password: account.password,
    });

    await waitForSignedIn(this.page);
    await this.goToSettings(account.slug);

    return { ...account, connectionId };
  }

  /**
   * `:visible` is load-bearing, not decoration.
   *
   * The App Router streams a route into a `<div hidden>` staging area and
   * then moves it into the live tree, so for a few hundred milliseconds after
   * a navigation the form exists *twice* — once hidden, once live. A bare
   * locator matches both and fails Playwright's strict mode, which is a
   * flake that looks exactly like a broken page. Measured on this route: the
   * duplicate is gone by ~650ms.
   *
   * Filtering to the visible copy is also the honest assertion — a form the
   * user cannot see is not a rendered form. `.first()` would have silenced
   * the same error while hiding a genuine double-render.
   */
  async goToSettings(slug: string) {
    await this.page.goto(`/home/${slug}/studio/analytics/settings`);

    await expect(
      this.page.locator('[data-test="account-targets-form"]:visible'),
    ).toBeVisible();
  }

  accountWatchHours() {
    return this.page.locator('[data-test="account-watch-hours-input"]:visible');
  }

  accountSubscribers() {
    return this.page.locator('[data-test="account-subscribers-input"]:visible');
  }

  accountTagMinSample() {
    return this.page.locator(
      '[data-test="account-tag-min-sample-input"]:visible',
    );
  }

  accountSubmit() {
    return this.page.locator('[data-test="account-targets-submit"]:visible');
  }

  accountSavedSummary() {
    return this.page.locator('[data-test="account-targets-saved"]:visible');
  }

  channelWatchHours() {
    return this.page.locator('[data-test="channel-watch-hours-input"]:visible');
  }

  channelSubscribers() {
    return this.page.locator('[data-test="channel-subscribers-input"]:visible');
  }

  channelStatusTrigger() {
    return this.page.locator('[data-test="channel-status-trigger"]:visible');
  }

  channelJoined() {
    return this.page.locator('[data-test="channel-joined-input"]:visible');
  }

  channelSubmit() {
    return this.page.locator('[data-test="channel-targets-submit"]:visible');
  }

  /** Radix renders options in a portal, so they are selected by role. */
  async chooseStatus(label: string) {
    await this.channelStatusTrigger().click();
    await this.page.getByRole('option', { name: label, exact: true }).click();
  }

  async saveAccount() {
    await this.accountSubmit().click();
    await this.expectAccountSaved();
  }

  async saveChannel() {
    await this.channelSubmit().click();
    await this.expectChannelSaved();
  }

  expectAccountSaved() {
    return expect(
      this.page.getByText('Analytics settings saved'),
    ).toBeVisible();
  }

  expectChannelSaved() {
    return expect(
      this.page.getByText('Saved settings for Seeded Channel'),
    ).toBeVisible();
  }
}
