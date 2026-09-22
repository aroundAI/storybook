import { expect, test } from '@playwright/test';

import { LanguageTabPageObject } from './language-tab.po';

/**
 * The Language tab's dimension control (FILM-1702).
 *
 * Needs no ClickHouse: whichever language the figures are grouped by must be
 * chosen, named and reachable on a project with no figures at all, which is
 * every project in production today. `language-evidence.spec.ts` holds the
 * assertions about the numbers.
 */
test.describe('FILM-1702 — the language dimension', () => {
  test('defaults to content language, and both settings are reachable', async ({
    page,
  }) => {
    const tab = new LanguageTabPageObject(page);
    const { team, project } = await tab.setup();

    await tab.open(team.slug, project.slug);

    // The default is the dimension every other analytics surface filters on.
    await expect(tab.dimensionOption('content')).toHaveAttribute(
      'data-state',
      'on',
    );
    await expect(tab.dimensionOption('content')).toHaveText('Content language');
    await expect(tab.dimensionOption('channel')).toHaveText(
      'Channel target language',
    );
    await expect(tab.description()).toContainText('not counted as English');

    await tab.chooseDimension('channel');

    await expect(tab.dimensionOption('content')).toHaveAttribute(
      'data-state',
      'off',
    );
    await expect(tab.description()).toContainText(
      'the language each channel is set up to serve',
    );

    // And back: the second change is where a control that only appeared to
    // be controlled shows itself.
    await tab.chooseDimension('content');

    await expect(tab.dimensionOption('channel')).toHaveAttribute(
      'data-state',
      'off',
    );
    await expect(tab.description()).toContainText('not counted as English');
  });

  test('cannot be left with no dimension selected', async ({ page }) => {
    const tab = new LanguageTabPageObject(page);
    const { team, project } = await tab.setup();

    await tab.open(team.slug, project.slug);

    // A single-select toggle group deselects on a second click of the active
    // item. With nothing selected the cards would still be showing one of
    // the two dimensions, and nothing would say which.
    await tab.dimensionOption('content').click();

    await expect(tab.dimensionOption('content')).toHaveAttribute(
      'data-state',
      'on',
    );
    await expect(tab.description()).toContainText('not counted as English');
  });
});
