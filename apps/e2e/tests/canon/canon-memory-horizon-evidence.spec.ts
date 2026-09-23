import { expect, test } from '@playwright/test';

import { CanonSettingsPageObject } from './canon-settings.po';

/**
 * Screenshots and DOM measurements for the memory horizon slider
 * (FILM-1110). Not a guard — `canon-memory-horizon.spec.ts` holds those.
 * Skipped unless CAPTURE_EVIDENCE is set, so it costs CI nothing.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('Canon settings memory horizon — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('captures automatic, custom, reset and a second type', async ({
    page,
    browser,
  }) => {
    const canon = new CanonSettingsPageObject(page);
    const { team, project } = await canon.setup('series');
    const card = page.locator('form', { has: canon.enabledSwitch() });
    const measured: Array<Record<string, unknown>> = [];

    const measure = async (state: string) => {
      measured.push({
        state,
        label: await canon.horizonLabel().textContent(),
        sliderValue: await canon.horizonThumb().getAttribute('aria-valuenow'),
        saved: await canon.savedCanon(project.id),
      });
    };

    await canon.enableCanon();
    await card.screenshot({ path: `${OUT}/01-series-automatic.png` });
    await measure('series, opened');

    await canon.save();
    await canon.open(team, project);
    await expect(canon.horizonLabel()).toContainText('automatic, Series');
    await card.screenshot({
      path: `${OUT}/02-series-after-untouched-save.png`,
    });
    await measure('series, reloaded after saving with the slider untouched');

    await canon.setHorizon(15);
    await canon.save();
    await canon.open(team, project);
    await expect(canon.horizonLabel()).toContainText('custom');
    await card.screenshot({ path: `${OUT}/03-series-custom-15.png` });
    await measure('series, reloaded after choosing 15');

    await canon.resetButton().click();
    await canon.save();
    await canon.open(team, project);
    await expect(canon.horizonLabel()).toContainText('automatic, Series');
    await card.screenshot({ path: `${OUT}/04-series-reset-automatic.png` });
    await measure('series, reloaded after Reset to automatic');

    // A second user, so a fresh browser context rather than this signed-in page.
    const adPage = await browser.newPage();
    const ad = new CanonSettingsPageObject(adPage);
    const adSeed = await ad.setup('ad');
    await ad.enableCanon();
    await adPage
      .locator('form', { has: ad.enabledSwitch() })
      .screenshot({ path: `${OUT}/05-ad-automatic.png` });
    measured.push({
      state: 'ad, opened',
      label: await ad.horizonLabel().textContent(),
      sliderValue: await ad.horizonThumb().getAttribute('aria-valuenow'),
      saved: await ad.savedCanon(adSeed.project.id),
    });

    console.log(`FILM-1110 measured:\n${JSON.stringify(measured, null, 2)}`);
  });
});
