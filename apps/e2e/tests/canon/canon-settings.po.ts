import { Page, expect } from '@playwright/test';

import {
  type SeededProject,
  type SeededTeam,
  readRows,
  seedProject,
  seedTeamAccount,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * The Canon settings form on a project's Settings page (FILM-1110).
 *
 * The memory horizon slider must show the horizon generation will actually
 * use. Before FILM-1110 it opened at 10 whatever the project type, and any
 * save of the form — enabling canon, changing enforcement — wrote that 10
 * as if the user had chosen it.
 */
export class CanonSettingsPageObject {
  constructor(private readonly page: Page) {}

  /**
   * A team, a project of the given type with no saved canon settings, and a
   * signed-in owner on its Settings page.
   */
  async setup(projectType: string) {
    const team = await seedTeamAccount();
    const project = await seedProject(team);

    await updateRows('projects', `id=eq.${project.id}`, {
      metadata: { projectType },
    });

    await signInAs(this.page, team);
    await this.open(team, project);

    return { team, project };
  }

  async open(team: Pick<SeededTeam, 'slug'>, project: SeededProject) {
    await this.page.goto(`/home/${team.slug}/studio/${project.slug}/settings`);
    await expect(this.enabledSwitch()).toBeVisible();
  }

  /**
   * Visible matches only. While the settings page streams in, React holds
   * the finished form in a hidden container for a moment before swapping it
   * into place, so a bare `[data-test=…]` briefly matches twice and
   * Playwright's strict mode fails at once instead of retrying. A user only
   * ever sees one form; so do these locators.
   */
  private visible(selector: string) {
    return this.page.locator(selector).filter({ visible: true });
  }

  enabledSwitch() {
    return this.visible('[data-test="canon-enabled-switch"]');
  }

  horizonLabel() {
    return this.visible('[data-test="canon-memory-horizon-label"]');
  }

  resetButton() {
    return this.visible('[data-test="canon-memory-horizon-reset"]');
  }

  /** The slider's thumb: the focusable element carrying the value. */
  horizonThumb() {
    return this.visible(
      '[data-test="canon-memory-horizon-slider"] [role="slider"]',
    );
  }

  async enableCanon() {
    if ((await this.enabledSwitch().getAttribute('data-state')) !== 'checked') {
      await this.enabledSwitch().click();
    }
    await expect(this.horizonLabel()).toBeVisible();
  }

  /** Moves the slider with the keyboard: Home is 1, each → adds one. */
  async setHorizon(value: number) {
    await this.horizonThumb().focus();
    await this.page.keyboard.press('Home');
    for (let step = 1; step < value; step++) {
      await this.page.keyboard.press('ArrowRight');
    }
    await expect(this.horizonThumb()).toHaveAttribute(
      'aria-valuenow',
      String(value),
    );
  }

  async save() {
    await this.visible('[data-test="canon-settings-save"]').click();
    await expect(this.page.getByText('Canon settings saved')).toBeVisible();
  }

  /** What the save wrote, read back with the service role. */
  async savedCanon(projectId: string) {
    const [row] = await readRows<{ metadata: { canon?: unknown } }>(
      'projects',
      `id=eq.${projectId}&select=metadata`,
    );

    return row?.metadata.canon as
      | { memoryHorizon?: number | null; memoryHorizonMode?: string }
      | undefined;
  }
}
