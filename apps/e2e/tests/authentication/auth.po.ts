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
    await this.page.click('[data-test="account-dropdown-trigger"]');
    await this.page.click('[data-test="account-dropdown-sign-out"]');
  }

  async signIn(params: { email: string; password: string }) {
    await this.page.waitForTimeout(500);

    await this.page.fill('input[name="email"]', params.email);
    await this.page.fill('input[name="password"]', params.password);
    await this.page.click('button[type="submit"]');
  }

  async signUp(params: {
    email: string;
    password: string;
    repeatPassword: string;
  }) {
    await this.page.waitForTimeout(500);

    await this.page.fill('input[name="email"]', params.email);
    await this.page.fill('input[name="password"]', params.password);
    await this.page.fill('input[name="repeatPassword"]', params.repeatPassword);

    await this.page.click('button[type="submit"]');
  }

  async submitMFAVerification(key: string) {
    const period = 30;

    const { TOTP } = await import('totp-generator');

    // Wait out the tail of the current window before generating.
    //
    // `TOTP.generate` returns the code for whichever window is current at the
    // moment it is called, with no regard for how much of that window is
    // left. Generated with a second to go, the code is stale by the time the
    // form submits and the server checks it — a race that lands a few percent
    // of the time and looks exactly like a broken login.
    //
    // The callers' answer to that was a retry ladder, which treats the
    // symptom and costs a whole test's budget when it fires. Starting a
    // fresh window costs at most three seconds and removes the race.
    const secondsLeft = period - (Math.floor(Date.now() / 1000) % period);

    if (secondsLeft < 3) {
      await this.page.waitForTimeout(secondsLeft * 1000 + 250);
    }

    const { otp } = await TOTP.generate(key, {
      period,
    });

    console.log(`OTP ${otp} code`, {
      period,
      secondsLeftWhenGenerated: period - (Math.floor(Date.now() / 1000) % period),
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
