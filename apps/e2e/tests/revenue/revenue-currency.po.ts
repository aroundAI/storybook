import { Page, expect } from '@playwright/test';

import {
  SeededProject,
  SeededTeam,
  seedProject,
  seedPublishedEpisode,
  seedRevenueRecord,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/** A local calendar day `n` days back, as the dashboard's date range reads it. */
export function daysAgo(n: number): string {
  const day = new Date();

  day.setDate(day.getDate() - n);

  const month = String(day.getMonth() + 1).padStart(2, '0');
  const date = String(day.getDate()).padStart(2, '0');

  return `${day.getFullYear()}-${month}-${date}`;
}

export interface CurrencyFixture {
  team: SeededTeam;
  project: SeededProject;
  connectionId: string;
  publishId: string;
}

/**
 * The revenue dashboard for an account paid in one currency or two (KB-12).
 *
 * The figures are chosen so the wrong implementation states a different
 * number. Inside the dashboard's default 30-day window:
 *
 * | Row                          | second currency | single currency |
 * |------------------------------|-----------------|-----------------|
 * | video, ads (synced)          | $1,200          | $1,200          |
 * | video, premium (synced)      | $400            | $400            |
 * | video, sponsorship (typed)   | €600            | $600            |
 * | channel, product (typed)     | €200            | $200            |
 *
 * and $1,000 of ads in the window before it, for the trend.
 *
 * Two currencies: $1,600 (+60.0%) and €800 (+100.0%). Added together they
 * are "$2,400" and +140.0%, which is what the dashboard said before — and
 * what the single-currency account must go on saying.
 */
export class RevenueCurrencyPageObject {
  constructor(private readonly page: Page) {}

  async setup(secondCurrency: 'EUR' | 'USD'): Promise<CurrencyFixture> {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connectionId = await seedYouTubeConnection(team.accountId);

    const { publishId } = await seedPublishedEpisode(project.id, connectionId, {
      title: 'Sponsored video',
    });

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
      currency: secondCurrency,
      category: 'sponsorship',
      source: 'manual',
    });
    await seedRevenueRecord({
      accountId: team.accountId,
      revenueCents: 20_000,
      recordDate: daysAgo(3),
      currency: secondCurrency,
      category: 'product',
      source: 'manual',
    });
    await seedRevenueRecord({
      publishId,
      revenueCents: 100_000,
      recordDate: daysAgo(40),
      category: 'ads',
    });

    await signInAs(this.page, team);

    return { team, project, connectionId, publishId };
  }

  async goToRevenue(slug: string) {
    await this.page.goto(`/home/${slug}/studio/analytics`);

    await expect(this.tiles('total').first()).toBeVisible();
  }

  tiles(name: 'total' | 'daily' | 'rpm' | 'projection') {
    return byTest(this.page, `revenue-tile-${name}`);
  }

  /** The figure a tile states, without its title or caption. */
  tileValues(name: 'total' | 'daily' | 'rpm' | 'projection') {
    return this.page.locator(
      `[data-test="revenue-tile-${name}"] [data-test="revenue-tile-value"]`,
    );
  }

  mixCards() {
    return byTest(this.page, 'revenue-mix-card');
  }

  async openTab(tab: 'overview' | 'platforms' | 'content' | 'manual') {
    await this.page.click(`[data-test="revenue-tab-${tab}"]`);
  }

  platformCards() {
    return byTest(this.page, 'revenue-platform-card');
  }

  topContentTables() {
    return byTest(this.page, 'revenue-top-content');
  }
}
