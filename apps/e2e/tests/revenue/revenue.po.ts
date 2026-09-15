import { Page, expect } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { seedTeamAccount } from '../utils/seed';

/**
 * The manual revenue entry form.
 *
 * This form was unsubmittable in three different ways over three review
 * rounds, and every one of them survived static review and unit tests:
 * an empty-string publishId failing uuid validation, an accountId injected
 * after the resolver had already run, and fields whose DOM state and form
 * state drifted apart after a reset. The last kind only appears on the
 * *second* submission, which is why these tests always submit twice.
 */
export class RevenuePageObject {
  private readonly page: Page;
  public auth: AuthPageObject;

  constructor(page: Page) {
    this.page = page;
    this.auth = new AuthPageObject(page);
  }

  /**
   * Seeds a confirmed user and a team account, signs in, and lands on the
   * revenue analytics page.
   *
   * The account is seeded through the API rather than created through the
   * UI. Signing up, waiting on a confirmation mail and driving the account
   * selector are three flows deep before a revenue test can begin, they
   * have their own specs, and two of them are what the admin suite already
   * flakes on — a failure there would read as a broken revenue test.
   */
  async setup() {
    const account = await seedTeamAccount();

    await this.auth.goToSignIn();

    // Filled here rather than through AuthPageObject.signIn, which waits a
    // fixed 500ms before typing. On a cold page that loses the race with
    // hydration: the values land, React attaches, and the inputs come back
    // empty — the form then sits there until waitForURL times out. Waiting
    // for the control to be ready is the same wait, but on the right
    // signal.
    const email = this.page.locator('input[name="email"]');

    await email.waitFor({ state: 'visible' });
    await email.fill(account.email);
    await this.page.fill('input[name="password"]', account.password);

    // Proof the values survived hydration before anything is submitted.
    await expect(email).toHaveValue(account.email);

    await this.page.click('button[type="submit"]');
    await this.page.waitForURL('**/home');
    await this.goToRevenue(account.slug);

    return account;
  }

  async goToRevenue(slug: string) {
    await this.page.goto(`/home/${slug}/studio/analytics`);
    await this.page.click('[data-test="revenue-tab-manual"]');

    await expect(
      this.page.locator('[data-test="manual-revenue-form"]'),
    ).toBeVisible();
  }

  amountInput() {
    return this.page.locator('[data-test="revenue-amount-input"]');
  }

  categoryTrigger() {
    return this.page.locator('[data-test="revenue-category-trigger"]');
  }

  currencyTrigger() {
    return this.page.locator('[data-test="revenue-currency-trigger"]');
  }

  publishTrigger() {
    return this.page.locator('[data-test="revenue-publish-trigger"]');
  }

  /**
   * Today as the trigger should render it, read from the page's clock.
   *
   * Matches date-fns `PPP` — "September 15th, 2026".
   */
  async expectedDateText() {
    return this.page.evaluate(() => {
      const now = new Date();
      const day = now.getDate();
      const suffix =
        day % 10 === 1 && day !== 11
          ? 'st'
          : day % 10 === 2 && day !== 12
            ? 'nd'
            : day % 10 === 3 && day !== 13
              ? 'rd'
              : 'th';
      const month = now.toLocaleDateString('en-US', { month: 'long' });

      return `${month} ${day}${suffix}, ${now.getFullYear()}`;
    });
  }

  dateTrigger() {
    return this.page.locator('[data-test="revenue-date-trigger"]');
  }

  submitButton() {
    return this.page.locator('[data-test="revenue-submit"]');
  }

  async fillAmount(dollars: string) {
    await this.amountInput().fill(dollars);
  }

  /** Radix renders options in a portal, so they are selected by role. */
  async chooseCategory(label: string) {
    await this.categoryTrigger().click();
    await this.page.getByRole('option', { name: label, exact: true }).click();
  }

  async chooseCurrency(label: string) {
    await this.currencyTrigger().click();
    await this.page.getByRole('option', { name: label, exact: true }).click();
  }

  /**
   * Picks today from the calendar popover.
   *
   * By `data-day`, which react-day-picker sets to the cell's ISO date.
   * Matching on the day number instead hits the wrong cell roughly one day
   * a month: `showOutsideDays` is on, so the grid opens with the previous
   * month's trailing days — on 30 September the first `30` in the DOM is
   * 30 August, it is in the past so no guard blocks it, and the test
   * silently records a date a month early while still passing.
   */
  async pickToday() {
    await this.page.click('[data-test="revenue-date-trigger"]');

    // Computed *in the page*, because that is whose clock `data-day` and
    // the calendar's `date > new Date()` guard both use.
    //
    // Two zones are in play and they are not the same one: `test.use({
    // timezoneId })` pins the browser, while the runner keeps its own —
    // UTC in CI. Reading `new Date()` here compared a UTC day against a
    // Pacific grid, so between 00:00 and 08:00 UTC the selector named
    // tomorrow, that cell is rendered but disabled, and the click waited
    // out the whole timeout. An earlier version of this comment claimed to
    // have fixed exactly that while still reading the runner's clock.
    const local = await this.page.evaluate(() => {
      const now = new Date();

      return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-');
    });

    await this.page.click(`[role="gridcell"][data-day="${local}"] button`);

    // Radix does not close the popover on select, so leaving it open makes
    // every later interaction depend on where floating-ui placed it — and
    // makes a second pickToday() click the trigger *shut* rather than
    // reopening it. Closing explicitly keeps the state deterministic.
    await this.page.keyboard.press('Escape');
    await expect(this.page.locator('[role="gridcell"]').first()).toBeHidden();
  }

  async submit() {
    await this.submitButton().click();
  }

  /**
   * A complete entry, which is the only way to reach the action at all —
   * the schema requires a date and a non-zero amount.
   */
  async addEntry(params: { dollars: string; category: string }) {
    await this.fillAmount(params.dollars);
    await this.pickToday();
    await this.chooseCategory(params.category);
    await this.submit();
  }

  expectSuccessToast() {
    return expect(
      this.page.getByText('Revenue entry added successfully'),
    ).toBeVisible();
  }
}
