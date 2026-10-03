import { test } from '@playwright/test';

import { byTest } from '../utils/visible';
import { ConnectedAppsPageObject } from './connected-apps.po';

/**
 * Screenshots for the PR (FILM-1904). Not a guard: `connected-apps.spec.ts`
 * holds those. Skipped unless CAPTURE_EVIDENCE is set.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('Connected apps — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('captures the token lifecycle', async ({ page }) => {
    const settings = new ConnectedAppsPageObject(page);
    await settings.setup();

    await page.screenshot({ path: `${OUT}/01-empty.png`, fullPage: true });

    await settings.submit().click();
    await byTest(page, 'pat-name-error').waitFor();
    await page.screenshot({
      path: `${OUT}/02-blank-name-refused.png`,
      fullPage: true,
    });

    await settings.create('Claude Desktop', ['read', 'write']);
    await page.screenshot({
      path: `${OUT}/03-token-shown-once.png`,
      fullPage: true,
    });

    await settings.dismissReveal().click();
    await page.screenshot({
      path: `${OUT}/04-after-dismiss-form-reset.png`,
      fullPage: true,
    });

    await byTest(
      settings.row('Claude Desktop'),
      'mcp-connection-revoke',
    ).click();
    await byTest(page, 'mcp-connection-revoke-confirm').waitFor();
    await page.screenshot({
      path: `${OUT}/05-revoke-confirm.png`,
      fullPage: true,
    });

    await byTest(page, 'mcp-connection-revoke-confirm').click();
    await byTest(settings.row('Claude Desktop'), 'mcp-connection-status')
      .filter({ hasText: 'Revoked' })
      .waitFor();
    await page.screenshot({ path: `${OUT}/06-revoked.png`, fullPage: true });
  });
});
