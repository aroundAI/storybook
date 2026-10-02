import { expect, test } from '@playwright/test';

import { seedTeamAccount, seedTeamForUser, uniqueStamp } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { ConnectedAppsPageObject } from './connected-apps.po';
import {
  CALLBACK_PATH,
  authorizeUrl,
  callbackParams,
  exchangeCode,
  pkce,
  registerClient,
} from './oauth-client';

/**
 * The PR screenshots for FILM-1907 (CLAUDE.md, "Screenshots are required
 * for UI changes"): the consent page as Claude's user sees it, the choice
 * made, the grant in Connected apps, the state after revoking, and the
 * page a bad redirect URI gets. Skipped unless CAPTURE_EVIDENCE is set.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('MCP OAuth consent: evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('consent, approval, Connected apps and revocation', async ({ page }) => {
    const stamp = uniqueStamp().slice(0, 8);
    const user = await seedTeamAccount({
      emailPrefix: 'oauth-evidence',
      name: `Harbour Films ${stamp}`,
    });
    const second = await seedTeamForUser(user, `Night Shift Studio ${stamp}`);
    const registered = await registerClient({ clientName: 'Claude' });
    const clientId = registered.body.client_id!;
    const { verifier, challenge } = pkce();

    await signInAs(page, user);
    await page.goto(authorizeUrl({ clientId, challenge }));
    await byTest(page, 'oauth-consent').waitFor();
    await byTest(page, 'oauth-consent').screenshot({
      path: `${OUT}/01-consent-page.png`,
    });

    await byTest(page, `oauth-consent-team-${second.slug}`).click();
    await byTest(page, 'oauth-consent-scope-render').click();
    await byTest(page, 'oauth-consent').screenshot({
      path: `${OUT}/02-consent-team-chosen-render-withheld.png`,
    });

    await byTest(page, 'oauth-consent-approve').click();
    await page.waitForURL((url) => url.pathname === CALLBACK_PATH);

    const { code } = callbackParams(new URL(page.url()));
    const tokens = await exchangeCode({ code: code!, clientId, verifier });
    expect(tokens.status).toBe(200);

    const settings = new ConnectedAppsPageObject(page);
    await settings.goTo(second.slug);
    await expect(settings.row('Claude')).toHaveCount(1);
    await byTest(page, 'connected-apps-settings').screenshot({
      path: `${OUT}/03-connected-apps-oauth-grant.png`,
    });

    await settings.revoke('Claude');
    await byTest(page, 'mcp-connections-card').screenshot({
      path: `${OUT}/04-connected-apps-after-revoke.png`,
    });

    await page.goto(
      authorizeUrl({
        clientId,
        challenge,
        redirectUri: 'https://evil.example/callback',
      }),
    );
    await byTest(page, 'oauth-authorize-error').waitFor();
    await byTest(page, 'oauth-authorize-error').screenshot({
      path: `${OUT}/05-unregistered-redirect-uri.png`,
    });
  });
});
