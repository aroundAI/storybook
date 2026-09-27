import { describe, expect, it } from 'vitest';

import { renderInviteEmail } from '@kit/email-templates';

/**
 * The invite email's main line is an i18n string with markup in it
 * (`<strong>{{inviter}}</strong> … <strong>{{teamName}}</strong>`), rendered
 * with `dangerouslySetInnerHTML`. The team name and the inviter's name are
 * written by any signed-in user, and the email goes to someone else's inbox.
 * They must arrive as text.
 */
const TEAM =
  '<img src=x onerror=alert(1)>Acme</strong><a href="https://evil.test">';
const INVITER = '<script>alert(2)</script>Eve';

describe('renderInviteEmail', () => {
  it('escapes the team and inviter names inside the markup it renders', async () => {
    const { html } = await renderInviteEmail({
      teamName: TEAM,
      inviter: INVITER,
      invitedUserEmail: 'invitee@example.test',
      link: 'https://example.test/join',
      productName: 'Storybook',
    });

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(2)');
    expect(html).not.toContain('href="https://evil.test"');
    // Still there, as text.
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;Acme');
  });
});
