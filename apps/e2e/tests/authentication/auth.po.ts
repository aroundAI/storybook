import { Page, expect } from '@playwright/test';

import { Mailbox } from '../utils/mailbox';

export class AuthPageObject {
  private readonly page: Page;
  private readonly mailbox: Mailbox;

  constructor(page: Page) {
    this.page = page;
    this.mailbox = new Mailbox(page);
  }

  goToSignIn() {
    return this.page.goto('/auth/sign-in');
  }

  goToSignUp() {
    return this.page.goto('/auth/sign-up');
  }

  async signOut() {
    // Retried, because a click on a trigger that has painted but not
    // hydrated does nothing at all — and the failure then surfaces as a
    // timeout on the *menu item*, which reads as "the menu is missing"
    // rather than "the trigger was not listening yet". This is the same
    // shape as `openAccountsSelector` in the team-accounts page object,
    // and the same idiom.
    await expect(async () => {
      await this.page.click('[data-test="account-dropdown-trigger"]');

      await expect(
        this.page.locator('[data-test="account-dropdown-sign-out"]'),
      ).toBeVisible();
    }).toPass();

    await this.page.click('[data-test="account-dropdown-sign-out"]');
  }

  async signIn(params: { email: string; password: string }) {
    await this.fillCredentials(params);

    await this.page.click('button[type="submit"]');
  }

  async signUp(params: {
    email: string;
    password: string;
    repeatPassword: string;
  }) {
    await this.fillCredentials(params);

    await this.page.fill('input[name="repeatPassword"]', params.repeatPassword);
    await this.page.click('button[type="submit"]');
  }

  /**
   * Types credentials once the form can actually hold them.
   *
   * These two used to wait a flat 500ms and start typing. On a cold page
   * that loses the race with hydration: the values land in the DOM, React
   * attaches, the inputs come back empty, and the spec sits on an untouched
   * form until `waitForURL` times out — which reads as a broken test rather
   * than a slow page. It is the cause of the admin, auth and invitation
   * flakes, each of which costs a full E2E job under `--max-failures=1`.
   *
   * Waiting for the control is the same wait on a signal that means
   * something; the re-read afterwards is what proves the value survived
   * hydration rather than assuming a longer timer would have.
   */
  private async fillCredentials(params: { email: string; password: string }) {
    const email = this.page.locator('input[name="email"]');
    const password = this.page.locator('input[name="password"]');

    // Retried, not asserted. An earlier version filled once and asserted
    // the value had stuck, which correctly *detected* hydration wiping the
    // inputs — and then failed the test over it. CI flakes went 2 -> 5.
    //
    // Hydration clearing a field is recoverable: type it again. The loop
    // exits as soon as both values survive a re-read, so a page that was
    // ready keeps costing one pass.
    await expect(async () => {
      await email.fill(params.email);
      await password.fill(params.password);

      await expect(email).toHaveValue(params.email);
      await expect(password).toHaveValue(params.password);
    }).toPass({ timeout: 15_000 });
  }

  async submitMFAVerification(key: string) {
    const period = 30;

    const { TOTP } = await import('totp-generator');

    const { otp } = await TOTP.generate(key, {
      period,
    });

    console.log(`OTP ${otp} code`, {
      period,
    });

    await this.page.fill('[data-input-otp]', otp);
    await this.page.click('[data-test="submit-mfa-button"]');

    // Callers wrap this in `toPass()` to retry across the 30s TOTP window, so
    // it has to fail when the code is rejected. Without this the helper always
    // "passed" on the first attempt and the test carried on from the
    // verification screen it had never left.
    await expect(
      this.page.locator('[data-test="submit-mfa-button"]'),
    ).toBeHidden();
  }

  async visitConfirmEmailLink(
    email: string,
    params: {
      deleteAfter: boolean;
      subject?: string;
    } = {
      deleteAfter: true,
    },
  ) {
    return expect(async () => {
      const res = await this.mailbox.visitMailbox(email, params);

      expect(res).not.toBeNull();
    }).toPass();
  }

  createRandomEmail() {
    const value = Math.random() * 10000000000000;

    return `${value.toFixed(0)}@makerkit.dev`;
  }

  async signUpFlow(path: string) {
    const email = this.createRandomEmail();

    await this.page.goto(`/auth/sign-up?next=${path}`);

    await this.signUp({
      email,
      password: 'password',
      repeatPassword: 'password',
    });

    await this.visitConfirmEmailLink(email);

    return {
      email,
    };
  }

  async updatePassword(password: string) {
    await this.page.fill('[name="password"]', password);
    await this.page.fill('[name="repeatPassword"]', password);
    await this.page.click('[type="submit"]');
  }
}
