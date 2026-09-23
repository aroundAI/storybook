import { expect, test } from '@playwright/test';

import { CanonSettingsPageObject } from './canon-settings.po';

/**
 * The Canon settings memory horizon (FILM-1110).
 *
 * Generation uses the project type's horizon unless the user chose one — a
 * series looks back 50 episodes, an ad 1. The slider has to say so: before
 * this, it opened at 10 for every project, and saving the form for any
 * other reason (turning canon on, say) stored that 10 as the user's choice,
 * so a series silently dropped from 50 to 10.
 */
test.describe('Canon settings — memory horizon', () => {
  test('a series shows 50 automatic, and saving other changes keeps it automatic', async ({
    page,
  }) => {
    const canon = new CanonSettingsPageObject(page);
    const { team, project } = await canon.setup('series');

    await canon.enableCanon();
    await expect(canon.horizonLabel()).toHaveText(
      'Memory Horizon: 50 episodes (automatic, Series)',
    );

    // The slider is untouched; only the switch changed.
    await canon.save();

    const saved = await canon.savedCanon(project.id);
    expect(saved?.memoryHorizon ?? null).toBeNull();
    expect(saved?.memoryHorizonMode).toBe('automatic');

    await canon.open(team, project);
    await expect(canon.horizonLabel()).toHaveText(
      'Memory Horizon: 50 episodes (automatic, Series)',
    );
    await expect(canon.horizonThumb()).toHaveAttribute('aria-valuenow', '50');
  });

  test('a moved slider is saved as the user’s choice, and reset returns to automatic', async ({
    page,
  }) => {
    const canon = new CanonSettingsPageObject(page);
    const { team, project } = await canon.setup('series');

    await canon.enableCanon();
    await canon.setHorizon(15);
    await expect(canon.horizonLabel()).toHaveText(
      'Memory Horizon: 15 episodes (custom)',
    );
    await canon.save();

    expect(await canon.savedCanon(project.id)).toMatchObject({
      memoryHorizon: 15,
      memoryHorizonMode: 'custom',
    });

    await canon.open(team, project);
    await expect(canon.horizonLabel()).toHaveText(
      'Memory Horizon: 15 episodes (custom)',
    );

    await canon.resetButton().click();
    await expect(canon.horizonLabel()).toHaveText(
      'Memory Horizon: 50 episodes (automatic, Series)',
    );
    await expect(canon.resetButton()).toBeHidden();
    await canon.save();

    const saved = await canon.savedCanon(project.id);
    expect(saved?.memoryHorizon ?? null).toBeNull();
    expect(saved?.memoryHorizonMode).toBe('automatic');

    await canon.open(team, project);
    await expect(canon.horizonLabel()).toHaveText(
      'Memory Horizon: 50 episodes (automatic, Series)',
    );
  });

  test('an ad shows its own horizon of 1', async ({ page }) => {
    const canon = new CanonSettingsPageObject(page);
    await canon.setup('ad');

    await canon.enableCanon();
    await expect(canon.horizonLabel()).toHaveText(
      'Memory Horizon: 1 episode (automatic, Ad)',
    );
    await expect(canon.horizonThumb()).toHaveAttribute('aria-valuenow', '1');
  });
});
