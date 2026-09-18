import { Page, expect } from '@playwright/test';

import {
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * The experiment log (FILM-1610).
 *
 * The form gained two controlled selects, a channel select, a multi-select
 * video picker and a numeric field — every shape that went wrong in
 * FILM-1609, where each defect appeared only on the *second* submission,
 * after a `reset()` left the DOM and form state disagreeing. Hence the
 * tests here save twice and read the saved rows back.
 */
export class ExperimentsPageObject {
  constructor(private readonly page: Page) {}

  /**
   * A team with one channel and two published videos, signed in and on the
   * experiment log. Seeded through the API: sign-up, mail and the account
   * selector have their own specs and are not this test's subject.
   */
  async setup() {
    const team = await seedTeamAccount();
    const connectionId = await seedYouTubeConnection(
      team.accountId,
      'Experiment Channel',
    );
    const project = await seedProject(team);
    const first = await seedPublishedEpisode(project.id, connectionId, {
      number: 1,
    });
    const second = await seedPublishedEpisode(project.id, connectionId, {
      number: 2,
    });

    await signInAs(this.page, team);
    await this.goTo(team.slug);

    return {
      ...team,
      connectionId,
      projectId: project.id,
      publishIds: [first.publishId, second.publishId] as const,
    };
  }

  /** `:visible` for the same streaming reason as the settings suite. */
  async goTo(slug: string) {
    await this.page.goto(`/home/${slug}/studio/analytics/experiments`);
    await expect(this.form()).toBeVisible();
    // The picker renders its trigger only once the videos have loaded.
    await expect(this.field('video-picker-trigger')).toBeVisible();
  }

  form() {
    return this.page.locator('[data-test="experiment-form"]:visible');
  }

  field(testId: string) {
    return this.form().locator(`[data-test="${testId}"]`);
  }

  async choose(trigger: string, option: string) {
    await this.field(trigger).click();
    await this.page.locator(`[data-test="${option}"]`).click();
  }

  async chooseChannel(connectionId: string) {
    await this.field('experiment-channel')
      .locator('[data-test="channel-filter-trigger"]')
      .click();
    await this.page
      .locator(`[data-test="channel-filter-option-${connectionId}"]`)
      .click();
  }

  async linkVideo(publishId: string) {
    await this.field('video-picker-trigger').click();
    await this.page
      .locator(`[data-test="video-picker-option-${publishId}"]`)
      .click();
    await this.page.keyboard.press('Escape');
  }

  async submit() {
    await this.field('experiment-submit').click();
  }

  /** Waits for the save to land: the form resets its title when it does. */
  async submitAndWaitForReset() {
    await this.submit();
    await expect(this.page.getByText('Experiment logged')).toBeVisible();
    await expect(this.field('experiment-title')).toHaveValue('');
  }
}
