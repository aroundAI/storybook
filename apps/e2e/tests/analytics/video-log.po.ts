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

export interface VideoLogFixture {
  team: SeededTeam;
  project: SeededProject;
  connectionId: string;
  secondConnectionId: string;
  publishIds: string[];
}

/** The Video Log tab of a project's Analytics page (FILM-1615). */
export class VideoLogPageObject {
  constructor(private readonly page: Page) {}

  /**
   * A team, a project, two channels and a published episode on each.
   *
   * The published episodes are what the channel filter lists, and their
   * publish ids are what a ClickHouse-backed spec keys `video_dim` on.
   */
  async setup(): Promise<VideoLogFixture> {
    const team = await seedTeamAccount();
    const project = await seedProject(team);

    const connectionId = await seedYouTubeConnection(
      team.accountId,
      'Main Channel',
    );
    const secondConnectionId = await seedYouTubeConnection(
      team.accountId,
      'Second Channel',
    );

    const first = await seedPublishedEpisode(project.id, connectionId, {
      number: 1,
    });
    const second = await seedPublishedEpisode(project.id, secondConnectionId, {
      number: 2,
    });

    await signInAs(this.page, team);

    return {
      team,
      project,
      connectionId,
      secondConnectionId,
      publishIds: [first.publishId, second.publishId],
    };
  }

  async goToAnalytics(accountSlug: string, projectSlug: string) {
    await this.page.goto(
      `/home/${accountSlug}/studio/${projectSlug}/analytics`,
    );
  }

  async openVideoLog() {
    await this.page.locator('[data-test="analytics-tab-video-log"]').click();

    await expect(this.tab()).toBeVisible();
  }

  async openDeepDive() {
    await this.page.locator('[data-test="analytics-tab-deep-dive"]').click();

    await expect(
      this.page.locator('[data-test="deep-dive-tab"]:visible'),
    ).toBeVisible();
  }

  tab() {
    return this.page.locator('[data-test="video-log-tab"]:visible');
  }

  table() {
    return this.page.locator('[data-test="video-log-table"]:visible');
  }

  rows() {
    return this.page.locator('[data-test="video-log-row"]:visible');
  }

  channelFilter() {
    return this.tab().locator('[data-test="channel-filter-trigger"]');
  }

  async chooseChannel(connectionId: string | 'all') {
    await this.channelFilter().click();

    await this.page
      .locator(`[data-test="channel-filter-option-${connectionId}"]`)
      .click();
  }

  rangeLabel() {
    return this.page.locator('[data-test="video-log-range"]:visible');
  }

  next() {
    return this.page.locator('[data-test="video-log-next"]:visible');
  }

  previous() {
    return this.page.locator('[data-test="video-log-previous"]:visible');
  }

  async sortBy(column: 'title' | 'published_at' | 'lifetime_views') {
    await this.page
      .locator(`[data-test="video-log-sort-${column}"]:visible`)
      .click();
  }

  /** The cells of one column, in row order. */
  column(testId: string) {
    return this.table().locator(`[data-test="${testId}"]`);
  }
}
