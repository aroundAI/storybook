import { Page, expect, test } from '@playwright/test';

import { InvitationsPageObject } from './invitations.po';

test.describe('Invitations', () => {
  let page: Page;
  let invitations: InvitationsPageObject;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    invitations = new InvitationsPageObject(page);

    await invitations.setup();
  });

  test('users can delete invites', async () => {
    await invitations.navigateToMembers();
    await invitations.openInviteForm();

    const email = invitations.auth.createRandomEmail();

    const invites = [
      {
        email,
        role: 'member',
      },
    ];

    await invitations.inviteMembers(invites);

    await expect(invitations.getInvitations()).toHaveCount(1);

    await invitations.deleteInvitation(email);

    await expect(invitations.getInvitations()).toHaveCount(0);
  });

  test('users can update invites', async () => {
    await invitations.navigateToMembers();
    await invitations.openInviteForm();

    const email = invitations.auth.createRandomEmail();

    const invites = [
      {
        email,
        role: 'member',
      },
    ];

    await invitations.inviteMembers(invites);

    await expect(invitations.getInvitations()).toHaveCount(1);

    await invitations.updateInvitation(email, 'owner');

    const row = invitations.getInvitationRow(email);

    await expect(row.locator('[data-test="member-role-badge"]')).toHaveText(
      'Owner',
    );
  });
});

/*
 * Its own team, not the shared `beforeAll` one above. It counts every
 * invitation on the team, and "users can update invites" leaves one behind —
 * so run serially after it, this saw 2 and failed, and it flaked in CI.
 */
test.describe('Duplicate invitations', () => {
  test('user cannot invite a member of the team again', async ({ page }) => {
    const invitations = new InvitationsPageObject(page);

    await invitations.setup();
    await invitations.navigateToMembers();

    const email = invitations.auth.createRandomEmail();

    const invites = [
      {
        email,
        role: 'member',
      },
    ];

    await invitations.openInviteForm();
    await invitations.inviteMembers(invites);

    await expect(invitations.getInvitations()).toHaveCount(1);

    // Inviting the same address again must not add a second row. Wait for
    // that submission's server action to answer before counting, rather than
    // a fixed 500ms guess at how long it takes.
    await invitations.openInviteForm();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/members') &&
          response.request().method() === 'POST',
      ),
      invitations.inviteMembers(invites),
    ]);

    await expect(invitations.getInvitations()).toHaveCount(1);
  });
});

test.describe('Full Invitation Flow', () => {
  let page: Page;
  let invitations: InvitationsPageObject;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    invitations = new InvitationsPageObject(page);

    await invitations.setup();
  });

  test('should invite users and let users accept an invite', async () => {
    await invitations.navigateToMembers();

    const invites = [
      {
        email: invitations.auth.createRandomEmail(),
        role: 'member',
      },
      {
        email: invitations.auth.createRandomEmail(),
        role: 'member',
      },
    ];

    await invitations.openInviteForm();
    await invitations.inviteMembers(invites);

    const firstEmail = invites[0]!.email;

    await expect(invitations.getInvitations()).toHaveCount(2);

    // sign out and sign in with the first email
    await page.context().clearCookies();
    await page.reload();

    console.log(`Finding email to ${firstEmail} ...`);

    await invitations.auth.visitConfirmEmailLink(firstEmail);

    console.log(`Signing up with ${firstEmail} ...`);

    await invitations.auth.signUp({
      email: firstEmail,
      password: 'password',
      repeatPassword: 'password',
    });

    await invitations.auth.visitConfirmEmailLink(firstEmail);

    console.log(`Accepting invitation as ${firstEmail}`);

    await invitations.acceptInvitation();

    await invitations.teamAccounts.openAccountsSelector();

    await expect(invitations.teamAccounts.getTeams()).toHaveCount(1);
  });
});
