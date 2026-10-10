import { type Locator, Page, expect } from '@playwright/test';

import { seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * Settings → Connected apps (FILM-1904): personal access tokens for the MCP
 * endpoint. Seeds a team through the API and signs in once; the page itself
 * is what the spec exercises.
 */
export class ConnectedAppsPageObject {
  constructor(private readonly page: Page) {}

  async setup() {
    const account = await seedTeamAccount({ emailPrefix: 'mcp' });

    await signInAs(this.page, account);
    await this.goTo(account.slug);

    return account;
  }

  async goTo(slug: string) {
    await this.page.goto(`/home/${slug}/settings/connected-apps`);
    await byTest(this.page, 'connected-apps-settings').waitFor();
  }

  nameInput() {
    return byTest(this.page, 'pat-name-input');
  }

  scope(name: 'read' | 'write' | 'render' | 'publish') {
    return byTest(this.page, `pat-scope-${name}`);
  }

  submit() {
    return byTest(this.page, 'pat-create-submit');
  }

  reveal() {
    return byTest(this.page, 'pat-reveal');
  }

  revealedToken() {
    return byTest(this.page, 'pat-reveal-token');
  }

  dismissReveal() {
    return byTest(this.page, 'pat-reveal-dismiss');
  }

  rows() {
    return byTest(this.page, 'mcp-connection-row');
  }

  row(name: string): Locator {
    return this.rows().filter({
      has: byTest(this.page, 'mcp-connection-name').filter({ hasText: name }),
    });
  }

  async create(name: string, scopes: Array<'read' | 'write' | 'render'>) {
    await this.nameInput().fill(name);

    for (const scope of ['read', 'write', 'render'] as const) {
      const box = this.scope(scope);
      const checked = (await box.getAttribute('data-state')) === 'checked';

      if (checked !== scopes.includes(scope)) {
        await box.click();
      }
    }

    await this.submit().click();
    await this.reveal().waitFor();

    const token = (await this.revealedToken().textContent())?.trim() ?? '';
    expect(token).toMatch(/^sbk_pat_[A-Za-z0-9_-]{43}$/);

    return token;
  }

  async revoke(name: string) {
    await byTest(this.row(name), 'mcp-connection-revoke').click();
    await byTest(this.page, 'mcp-connection-revoke-confirm').click();
    await expect(byTest(this.row(name), 'mcp-connection-status')).toHaveText(
      'Revoked',
    );
  }
}
