import { Page, expect } from '@playwright/test';

import {
  SeededProject,
  SeededTeam,
  seedProject,
  seedTeamAccount,
} from '../utils/seed';
import { signInAs } from '../utils/session';

export type LanguageDimension = 'content' | 'channel';

export interface LanguageTabFixture {
  team: SeededTeam;
  project: SeededProject;
}

/** The Language tab of a project's Analytics page (FILM-1702). */
export class LanguageTabPageObject {
  constructor(private readonly page: Page) {}

  async setup(): Promise<LanguageTabFixture> {
    const team = await seedTeamAccount();
    const project = await seedProject(team);

    await signInAs(this.page, team);

    return { team, project };
  }

  async open(accountSlug: string, projectSlug: string) {
    await this.page.goto(
      `/home/${accountSlug}/studio/${projectSlug}/analytics`,
    );
    await this.page.locator('[data-test="analytics-tab-language"]').click();

    await expect(this.dimensionControl()).toBeVisible();
  }

  dimensionControl() {
    return this.page.locator('[data-test="language-dimension"]:visible');
  }

  dimensionOption(dimension: LanguageDimension) {
    return this.page.locator(
      `[data-test="language-dimension-${dimension}"]:visible`,
    );
  }

  description() {
    return this.page.locator(
      '[data-test="language-dimension-description"]:visible',
    );
  }

  async chooseDimension(dimension: LanguageDimension) {
    await this.dimensionOption(dimension).click();

    await expect(this.dimensionOption(dimension)).toHaveAttribute(
      'data-state',
      'on',
    );
  }

  /** A card's own statement of the dimension it is grouped by. */
  cardLabel(card: string) {
    return this.page.locator(
      `[data-test="language-dimension-label-${card}"]:visible`,
    );
  }

  /** `null` is the group for videos with no language set. */
  row(language: string | null) {
    return this.page.locator(
      `[data-test="language-row-${language ?? '__not_set__'}"]:visible`,
    );
  }

  rows() {
    return this.page.locator('[data-test^="language-row-"]:visible').filter({
      has: this.page.locator('[data-test="language-row-name"]'),
    });
  }

  async readRow(language: string | null) {
    const row = this.row(language);

    return {
      name: await row.locator('[data-test="language-row-name"]').innerText(),
      views: await row.locator('[data-test="language-row-views"]').innerText(),
      share: await row.locator('[data-test="language-row-share"]').innerText(),
      checkpoint: await row
        .locator('[data-test="language-row-checkpoint"]')
        .innerText(),
      dimmed: /opacity-60/.test((await row.getAttribute('class')) ?? ''),
    };
  }

  divergence() {
    return this.page.locator('[data-test="language-divergence"]:visible');
  }
}
