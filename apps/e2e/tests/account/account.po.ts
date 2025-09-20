import { Page, expect } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { OtpPo } from '../utils/otp.po';

export class AccountPageObject {
  private readonly page: Page;
  public auth: AuthPageObject;
  private otp: OtpPo;

  constructor(page: Page) {
    this.page = page;
    this.auth = new AuthPageObject(page);
    this.otp = new OtpPo(page);
  }

  async setup() {
    return this.auth.signUpFlow('/home/settings');
  }

  async updateName(name: string) {
    await this.page.fill('[data-test="update-account-name-form"] input', name);
    await this.page.click('[data-test="update-account-name-form"] button');
  }

  async updateEmail(email: string) {
    await expect(async () => {
      await this.page.fill(
        '[data-test="account-email-form-email-input"]',
        email,
      );

      await this.page.fill(
        '[data-test="account-email-form-repeat-email-input"]',
        email,
      );

      const click = this.page.click('[data-test="account-email-form"] button');

      const req = await this.page
        .waitForResponse((resp) => {
          return resp.url().includes('auth/v1/user');
        })
        .then((response) => {
          expect(response.status()).toBe(200);
        });

      return Promise.all([click, req]);
    }).toPass();
  }

  async updatePassword(password: string) {
    await this.page.fill(
      '[data-test="account-password-form-password-input"]',
      password,
    );

    await this.page.fill(
      '[data-test="account-password-form-repeat-password-input"]',
      password,
    );

    await this.page.click('[data-test="account-password-form"] button');
  }

  async deleteAccount(email: string) {
    // Click the delete account button to open the modal
    await this.page.click('[data-test="delete-account-button"]');

    // Complete the OTP verification process
    await this.otp.completeOtpVerification(email);

    await this.page.waitForTimeout(500);

    await this.page.click('[data-test="confirm-delete-account-button"]');
  }

  getProfileName() {
    return this.page.locator('[data-test="account-dropdown-display-name"]');
  }
}
