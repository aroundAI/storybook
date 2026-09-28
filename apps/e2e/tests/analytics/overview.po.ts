import { Page, expect } from '@playwright/test';

import { daysAgo } from '../revenue/revenue-currency.po';
import {
  SeededProject,
  SeededTeam,
  seedProject,
  seedPublishedEpisode,
  seedRevenueRecord,
  seedSeason,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

export interface OverviewFixture {
  team: SeededTeam;
  project: SeededProject;
  connectionId: string;
  publishId: string;
}

/**
 * The Overview tab of a project's Analytics page (KB-16).
 *
 * Three fixtures, chosen so the unfixed page states a different number:
 *
 * | Fixture         | Revenue rows in the window                                |
 * |-----------------|-----------------------------------------------------------|
 * | `'none'`        | none — the page used to draw 83/17 shares and a 70/30    |
 * |                 | revenue split anyway                                      |
 * | `'two'`         | $1,200 ads + $400 premium (synced), €600 sponsorship +   |
 * |                 | €200 product (typed), all on the video; plus $999 of      |
 * |                 | channel-level licensing that has no project and must not  |
 * |                 | appear                                                    |
 * | `'one'`         | the same four rows, all in dollars: $2,400                |
 *
 * So the two-currency Overview reads $1,600 (ads 75%, premium 25%) and €800
 * (sponsorship 75%, product 25%); before the fix it read "$0" split into
 * "Ad Revenue $0" and "Sponsorships $0" with 70/30 bars, because the card's
 * total came from ClickHouse and its split from two constants.
 */
export class OverviewPageObject {
  constructor(private readonly page: Page) {}

  async setup(revenue: 'none' | 'one' | 'two'): Promise<OverviewFixture> {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connectionId = await seedYouTubeConnection(team.accountId);
    const { seasonId } = await seedSeason(project.id);

    const { publishId } = await seedPublishedEpisode(project.id, connectionId, {
      title: 'Sponsored video',
      seasonId,
    });

    if (revenue !== 'none') {
      const second = revenue === 'two' ? 'EUR' : 'USD';

      await seedRevenueRecord({
        publishId,
        revenueCents: 120_000,
        recordDate: daysAgo(5),
        category: 'ads',
      });
      await seedRevenueRecord({
        publishId,
        revenueCents: 40_000,
        recordDate: daysAgo(5),
        category: 'premium',
      });
      await seedRevenueRecord({
        publishId,
        revenueCents: 60_000,
        recordDate: daysAgo(4),
        currency: second,
        category: 'sponsorship',
        source: 'manual',
      });
      await seedRevenueRecord({
        publishId,
        revenueCents: 20_000,
        recordDate: daysAgo(3),
        currency: second,
        category: 'product',
        source: 'manual',
      });
      // Channel-level: belongs to the account, not to this project.
      await seedRevenueRecord({
        accountId: team.accountId,
        revenueCents: 99_900,
        recordDate: daysAgo(2),
        category: 'licensing',
        source: 'manual',
      });
    }

    await signInAs(this.page, team);

    return { team, project, connectionId, publishId };
  }

  async goToOverview(fixture: OverviewFixture) {
    await this.page.goto(
      `/home/${fixture.team.slug}/studio/${fixture.project.slug}/analytics`,
    );

    // The grid is a skeleton until every Overview query has landed. Waited
    // on by heading rather than `data-test`, so the same wait works on the
    // unfixed page — the red run must fail on a figure, not on a selector.
    await expect(
      this.page.getByRole('heading', { name: 'Shares', exact: true }),
    ).toBeVisible();
  }

  card(name: 'shares' | 'comments' | 'platform-split') {
    return byTest(this.page, `overview-${name}`);
  }

  revenueCards() {
    return byTest(this.page, 'overview-revenue');
  }

  revenueRows(card: ReturnType<Page['locator']>) {
    return byTest(card, 'overview-revenue-row');
  }

  metricCards() {
    return this.page.locator('[data-test^="metric-card-"]');
  }

  metricChanges() {
    return byTest(this.page, 'metric-change');
  }

  /** Everything on the page, whitespace collapsed — the metric row too. */
  async pageText() {
    const text = await this.page.locator('body').innerText();

    return text.replace(/\s+/g, ' ');
  }
}
