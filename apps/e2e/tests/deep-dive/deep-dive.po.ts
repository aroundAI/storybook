import { Page, expect } from '@playwright/test';

import {
  SeededProject,
  SeededTeam,
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';

export interface DeepDiveFixture {
  team: SeededTeam;
  project: SeededProject;
  activeChannelId: string;
  inactiveChannelId: string;
}

/**
 * A project's Deep Dive tab (FILM-1611).
 *
 * ClickHouse is off in e2e, so every card shows its empty or zero state.
 * What a browser can prove here is the wiring: that the channel filter
 * lists the right channels, that its choice reaches the actions, and that
 * the per-channel YPP cards render one per channel.
 */
export class DeepDivePageObject {
  constructor(private readonly page: Page) {}

  /**
   * A team, a project, and two YouTube channels that each have a published
   * episode in it — one active, one disconnected. The project's channel list
   * comes from its published publishes, so without the episodes the filter
   * would have nothing to list and every assertion would pass on nothing.
   */
  async setup(): Promise<DeepDiveFixture> {
    const team = await seedTeamAccount();
    const project = await seedProject(team);

    const activeChannelId = await seedYouTubeConnection(
      team.accountId,
      'Active Channel',
    );

    const inactiveChannelId = await seedYouTubeConnection(
      team.accountId,
      'Retired Channel',
      { isActive: false },
    );

    await seedPublishedEpisode(project.id, activeChannelId, { number: 1 });
    await seedPublishedEpisode(project.id, inactiveChannelId, { number: 2 });

    await signInAs(this.page, team);
    await this.goToDeepDive(team.slug, project.slug);

    return { team, project, activeChannelId, inactiveChannelId };
  }

  async goToDeepDive(accountSlug: string, projectSlug: string) {
    await this.page.goto(
      `/home/${accountSlug}/studio/${projectSlug}/analytics`,
    );

    await this.page.locator('[data-test="analytics-tab-deep-dive"]').click();

    await expect(this.tab()).toBeVisible();
  }

  tab() {
    return this.page.locator('[data-test="deep-dive-tab"]:visible');
  }

  channelFilter() {
    return this.page.locator('[data-test="channel-filter-trigger"]:visible');
  }

  async chooseChannel(connectionId: string | 'all') {
    await this.channelFilter().click();

    await this.page
      .locator(`[data-test="channel-filter-option-${connectionId}"]`)
      .click();
  }

  yppCards() {
    return this.page.locator('[data-test="ypp-progress-card"]:visible');
  }

  subscriberEmpty() {
    return this.page.locator('[data-test="subscriber-series-empty"]:visible');
  }
}
