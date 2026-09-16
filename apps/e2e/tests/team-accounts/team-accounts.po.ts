import { Page, expect } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { OtpPo } from '../utils/otp.po';

export class TeamAccountsPageObject {
  private readonly page: Page;
  public auth: AuthPageObject;
  public otp: OtpPo;

  constructor(page: Page) {
    this.page = page;
    this.auth = new AuthPageObject(page);
    this.otp = new OtpPo(page);
  }

  async setup(params = this.createTeamName()) {
    const { email } = await this.auth.signUpFlow('/home');

    await this.createTeam(params);

    return { email, teamName: params.teamName, slug: params.slug };
  }

  getTeamFromSelector(teamName: string) {
    return this.page.locator(`[data-test="account-selector-team"]`, {
      hasText: teamName,
    });
  }

  getTeams() {
    return this.page.locator('[data-test="account-selector-team"]');
  }

  /**
   * `exact: true`, and the three below likewise.
   *
   * These were `locator('a', { hasText: 'Settings' })`, which is a *substring*
   * match on every link on the page. Adding a nav item called "Analytics
   * Settings" (FILM-1608) made it resolve to two elements and fail strict
   * mode — a deterministic break in a spec that has nothing to do with
   * analytics, and the first nav label in this repo to contain another one.
   *
   * It would not have been the last: "Members" and "Billing" had the same
   * shape, one label away from the same failure. Exact role-based names are
   * what Playwright's own strict-mode error suggests, and they cannot be
   * widened by a future label.
   */
  goToSettings() {
    return expect(async () => {
      await this.page
        .getByRole('link', { name: 'Settings', exact: true })
        .click();

      await this.page.waitForURL('**/home/*/settings');
    }).toPass();
  }

  goToMembers() {
    return expect(async () => {
      await this.page
        .getByRole('link', { name: 'Members', exact: true })
        .click();

      await this.page.waitForURL('**/home/*/members');
    }).toPass();
  }

  goToBilling() {
    return expect(async () => {
      await this.page
        .getByRole('link', { name: 'Billing', exact: true })
        .click();

      return await this.page.waitForURL('**/home/*/billing');
    }).toPass();
  }

  openAccountsSelector() {
    return expect(async () => {
      await this.page.click('[data-test="account-selector-trigger"]');

      return expect(
        this.page.locator('[data-test="account-selector-content"]'),
      ).toBeVisible();
    }).toPass();
  }

  async tryCreateTeam(teamName: string) {
    await this.page.locator('[data-test="create-team-form"] input').fill('');
    await this.page.waitForTimeout(200);
    await this.page.locator('[data-test="create-team-form"] input').fill(teamName);

    return this.page.click(
      '[data-test="create-team-form"] button:last-child',
    );
  }

  async createTeam({ teamName, slug } = this.createTeamName()) {
    await this.openAccountsSelector();

    await this.page.click('[data-test="create-team-account-trigger"]');
    await this.page.fill('[data-test="create-team-form"] input', teamName);

    const click = this.page.click(
      '[data-test="create-team-form"] button:last-child',
    );

    const response = this.page.waitForURL(`/home/${slug}`);

    await Promise.all([click, response]);
  }

  async updateName(name: string, slug: string) {
    await expect(async () => {
      await this.page.fill(
        '[data-test="update-team-account-name-form"] input',
        name,
      );

      const click = this.page.click(
        '[data-test="update-team-account-name-form"] button',
      );

      // the slug should be updated to match the new team name
      const response = this.page.waitForURL(`**/home/${slug}/settings`);

      return Promise.all([click, response]);
    }).toPass();
  }

  async deleteAccount(email: string) {
    await expect(async () => {
      await this.page.click('[data-test="delete-team-trigger"]');

      await this.otp.completeOtpVerification(email);

      const click = this.page.click(
        '[data-test="delete-team-form-confirm-button"]',
      );

      const response = this.page.waitForURL('**/home');

      return Promise.all([click, response]);
    }).toPass();
  }

  async updateMemberRole(memberEmail: string, newRole: string) {
    await expect(async () => {
      // Find the member row and click the actions button
      const memberRow = this.page.getByRole('row', { name: memberEmail });
      await memberRow.getByRole('button').click();

      // Click the update role option in the dropdown menu
      await this.page.getByText('Update Role').click();

      // Select the new role
      await this.page.click('[data-test="role-selector-trigger"]');
      await this.page.click(`[data-test="role-option-${newRole}"]`);

      // Click the confirm button
      const click = this.page.click('[data-test="confirm-update-member-role"]');

      // Wait for the update to complete and page to reload
      const response = this.page.waitForURL('**/home/*/members');

      return Promise.all([click, response]);
    }).toPass();
  }

  async transferOwnership(memberEmail: string, ownerEmail: string) {
    await expect(async () => {
      // Find the member row and click the actions button
      const memberRow = this.page.getByRole('row', { name: memberEmail });
      await memberRow.getByRole('button').click();

      // Click the transfer ownership option in the dropdown menu
      await this.page.getByText('Transfer Ownership').click();

      // Complete OTP verification
      await this.otp.completeOtpVerification(ownerEmail);

      // Click the confirm button
      const click = this.page.click(
        '[data-test="confirm-transfer-ownership-button"]',
      );

      // Wait for the transfer to complete and page to reload
      const response = this.page.waitForURL('**/home/*/members');

      return Promise.all([click, response]);
    }).toPass();
  }

  createTeamName() {
    const random = (Math.random() * 100000000).toFixed(0);

    const teamName = `Team-Name-${random}`;
    const slug = `team-name-${random}`;

    return { teamName, slug };
  }
}
