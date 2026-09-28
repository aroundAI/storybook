import { Page, expect } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { TeamAccountsPageObject } from '../team-accounts/team-accounts.po';
import { byTest } from '../utils/visible';

export class InvitationsPageObject {
  private readonly page: Page;
  public auth: AuthPageObject;
  public teamAccounts: TeamAccountsPageObject;

  constructor(page: Page) {
    this.page = page;
    this.auth = new AuthPageObject(page);
    this.teamAccounts = new TeamAccountsPageObject(page);
  }

  setup() {
    return this.teamAccounts.setup();
  }

  public async inviteMembers(
    invites: Array<{
      email: string;
      role: string;
    }>,
  ) {
    const form = this.getInviteForm();

    for (let index = 0; index < invites.length; index++) {
      const invite = invites[index];

      if (!invite) {
        continue;
      }

      console.log(`Inviting ${invite.email} with role ${invite.role}...`);

      const nth = index + 1;

      await this.page.fill(
        `[data-test="invite-member-form-item"]:nth-child(${nth}) [data-test="invite-email-input"]`,
        invite.email,
      );

      await this.page.click(
        `[data-test="invite-member-form-item"]:nth-child(${nth}) [data-test="role-selector-trigger"]`,
      );

      await this.page.click(`[data-test="role-option-${invite.role}"]`);

      if (index < invites.length - 1) {
        await byTest(form, 'add-new-invite-button').click();
      }
    }

    await form.locator('button[type="submit"]').click();
  }

  navigateToMembers() {
    return expect(async () => {
      await this.page
        .getByRole('link', { name: 'Members', exact: true })
        .click();

      await this.page.waitForURL('**/home/*/members');
    }).toPass();
  }

  async openInviteForm() {
    await expect(async () => {
      await this.page.click('[data-test="invite-members-form-trigger"]');

      return await expect(this.getInviteForm()).toBeVisible();
    }).toPass();
  }

  getInvitations() {
    return byTest(this.page, 'invitation-email');
  }

  async deleteInvitation(email: string) {
    const actions = this.getInvitationRow(email).getByRole('button');

    await actions.click();

    await byTest(this.page, 'remove-invitation-trigger').click();

    await this.page.click(
      '[data-test="delete-invitation-form"] button[type="submit"]',
    );
  }

  getInvitationRow(email: string) {
    return this.page.getByRole('row', { name: email });
  }

  async updateInvitation(email: string, role: string) {
    const row = this.getInvitationRow(email);
    const actions = row.getByRole('button');

    await actions.click();

    await byTest(this.page, 'update-invitation-trigger').click();

    await this.page.click(`[data-test="role-selector-trigger"]`);
    await this.page.click(`[data-test="role-option-${role}"]`);

    await this.page.click(
      '[data-test="update-invitation-form"] button[type="submit"]',
    );
  }

  async acceptInvitation() {
    console.log('Accepting invitation...');

    const click = this.page
      .locator('[data-test="join-team-form"] button[type="submit"]')
      .click();

    const response = this.page.waitForResponse((response) => {
      return (
        response.url().includes('/join') &&
        response.request().method() === 'POST'
      );
    });

    await Promise.all([click, response]);

    console.log('Invitation accepted');
  }

  private getInviteForm() {
    return byTest(this.page, 'invite-members-form');
  }
}
