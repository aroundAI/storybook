import { expect, test } from '@playwright/test';

import { seedProject, seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * Screenshots of the PageHeader with its description under the title (FILM-208),
 * on three of its callers. Not a guard: `asset-library.spec.ts` holds those.
 * Skipped unless CAPTURE_EVIDENCE is set. The admin caller is captured by
 * `tests/admin/page-header-evidence.spec.ts`, which needs the super-admin session.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('PageHeader description order — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('captures the assets, audio library and team home headers', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const project = await seedProject(team, { name: 'Header Evidence' });

    await signInAs(page, team);

    await page.goto(`/home/${team.slug}/studio/${project.slug}/assets`);
    await expect(byTest(page, 'assets-breadcrumb')).toBeVisible();
    await page.screenshot({ path: `${OUT}/page-header-assets.png` });

    await byTest(page, 'create-asset-button').focus();
    await page.keyboard.press('Control+K');
    await expect(byTest(page, 'create-character-item')).toBeVisible();
    await page.screenshot({ path: `${OUT}/assets-create-menu-ctrl-k.png` });

    await page.goto(`/home/${team.slug}/studio/${project.slug}/audio-library`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.screenshot({ path: `${OUT}/page-header-audio-library.png` });

    await page.goto(`/home/${team.slug}`);
    // TeamAccountLayoutPageHeader renders only the description (the
    // breadcrumbs); the dashboard title is not passed through to PageHeader.
    await expect(
      page.getByRole('navigation', { name: /breadcrumb/i }),
    ).toBeVisible();
    await page.screenshot({ path: `${OUT}/page-header-team-home.png` });
  });
});
