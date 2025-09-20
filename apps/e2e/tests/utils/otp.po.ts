import { Page, expect } from '@playwright/test';

import { Mailbox } from './mailbox';

export class OtpPo {
  private readonly page: Page;
  private readonly mailbox: Mailbox;

  constructor(page: Page) {
    this.page = page;
    this.mailbox = new Mailbox(page);
  }

  /**
   * Completes the OTP verification process
   * @param email The email address to send the OTP to
   */
  async completeOtpVerification(email: string) {
    // Click the "Send Verification Code" button
    await this.page.click('[data-test="otp-send-verification-button"]');

    // wait for the OTP to be sent
    await this.page.waitForTimeout(500);

    await expect(async () => {
      // Get the OTP code from the email
      const otpCode = await this.getOtpCodeFromEmail(email);

      expect(otpCode).not.toBeNull();

      // Enter the OTP code
      await this.enterOtpCode(otpCode);
    }).toPass();

    // Click the "Verify Code" button
    await this.page.click('[data-test="otp-verify-button"]');
  }

  /**
   * Retrieves the OTP code from an email
   * @param email The email address to check for the OTP
   * @returns The OTP code
   */
  async getOtpCodeFromEmail(email: string) {
    // Get the OTP from the email
    const otpCode = await this.mailbox.getOtpFromEmail(email);

    if (!otpCode) {
      throw new Error('Failed to retrieve OTP code from email');
    }

    return otpCode;
  }

  /**
   * Enters the OTP code into the input fields
   * @param otpCode The 6-digit OTP code
   */
  async enterOtpCode(otpCode: string) {
    console.log(`Entering OTP code: ${otpCode}`);
    await this.page.fill('[data-input-otp]', otpCode);
  }
}
