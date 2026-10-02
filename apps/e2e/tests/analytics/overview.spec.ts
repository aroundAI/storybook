import { expect, test } from '@playwright/test';

import { byTest } from '../utils/visible';
import { OverviewPageObject } from './overview.po';

/**
 * The Overview tab shows only what was measured (KB-16).
 *
 * Seeded through the API; ClickHouse is not needed. No views are measured here,
 * which is exactly the account these figures were invented for: before the
 * fix it saw a share donut of 83/17, "Ad Revenue" and "Sponsorships" at
 * 70/30, "Projection: $10k by month end", three canned footers, and a
 * change indicator beside every metric. `overview-evidence.spec.ts` adds
 * views and screenshots.
 */
const INVENTED = [
  // The share donut and its legend.
  'Direct',
  'Copy Link',
  // The 70/30 split and the projection.
  'Ad Revenue',
  'Sponsorships',
  '$10k',
  // The footers.
  'Viral coefficient',
  'Dominant performance',
  'generated the most discussion',
];

test.describe('Overview truth (KB-16)', () => {
  test('an account with nothing to break down sees no breakdown, no projection, no canned footer and no change indicator', async ({
    page,
  }) => {
    const overview = new OverviewPageObject(page);
    const fixture = await overview.setup('none');

    await overview.goToOverview(fixture);

    const text = await overview.pageText();

    for (const phrase of INVENTED) {
      expect(text, phrase).not.toContain(phrase);
    }

    // No previous period was measured, so no metric carries a percentage —
    // not "+100.0%", and not the "0.0%" a zero baseline used to draw. The
    // metric row sits between the Export button and the tab list; read by
    // text so the unfixed page, which has no `data-test` there, is measured
    // by the same rule. Each card now carries its provenance chip between
    // its label and its figure (FILM-1705), so the figure is read by id.
    // No row behind the total has a view, so since FILM-1720 it is not
    // measured — said in words, never drawn as 0 (KB-153).
    const metricRow = text.slice(
      text.indexOf('Export'),
      text.indexOf('Overview Content'),
    );

    // The one publish has no metric row, so Views was not measured: the card
    // says so instead of drawing 0 (KB-162).
    const views = byTest(page, 'metric-card-views');

    await expect(byTest(views, 'metric-not-measured')).toHaveText(
      'Not measured',
    );
    await expect(byTest(views, 'metric-value')).toHaveCount(0);
    expect(metricRow).not.toMatch(/\d+\.\d%/);
    await expect(overview.metricChanges()).toHaveCount(0);
    await expect(page.locator('[data-test^="metric-card-"]')).toHaveCount(7);

    // What replaces them: the total shares, and the fact that nothing more
    // is collected about them.
    await expect(overview.card('shares')).toContainText(
      'We don’t collect how content was shared, only how often.',
    );
    await expect(byTest(page, 'overview-revenue-none')).toContainText(
      'No revenue recorded',
    );
    await expect(overview.card('platform-split')).toContainText(
      'No views recorded in this period.',
    );
    await expect(byTest(page, 'overview-comments-most-discussed')).toHaveCount(
      0,
    );
  });

  test('a project paid in two currencies sees its recorded mix, one card per currency', async ({
    page,
  }) => {
    const overview = new OverviewPageObject(page);
    const fixture = await overview.setup('two');

    await overview.goToOverview(fixture);

    const text = await overview.pageText();

    expect(text).not.toContain('Ad Revenue');
    expect(text).not.toContain('$10k');

    await expect(overview.revenueCards()).toHaveCount(2);

    const [dollars, euros] = [
      overview.revenueCards().nth(0),
      overview.revenueCards().nth(1),
    ];

    // $1,200 ads + $400 premium: 75% / 25% of $1,600.
    await expect(dollars).toContainText('Revenue · USD');
    await expect(byTest(dollars, 'card-figure')).toHaveText('$1,600');
    await expect(overview.revenueRows(dollars)).toHaveText([
      'Ads$1,200 · 75%',
      'Premium$400 · 25%',
    ]);

    // €600 sponsorship + €200 product: 75% / 25% of €800. Never "$2,400".
    await expect(euros).toContainText('Revenue · EUR');
    await expect(byTest(euros, 'card-figure')).toHaveText('€800');
    await expect(overview.revenueRows(euros)).toHaveText([
      'Sponsorship€600 · 75%',
      'Product sales€200 · 25%',
    ]);

    // The $999 channel-level licensing row has no project and is not here;
    // the footer says where it is.
    expect(await overview.pageText()).not.toContain('$999');
    expect(await overview.pageText()).not.toContain('Licensing');
    await expect(dollars).toContainText(
      'Channel-level income is on the account’s Revenue tab.',
    );
  });

  test('a project paid in one currency sees one card, unnamed', async ({
    page,
  }) => {
    const overview = new OverviewPageObject(page);
    const fixture = await overview.setup('one');

    await overview.goToOverview(fixture);

    await expect(overview.revenueCards()).toHaveCount(1);

    const card = overview.revenueCards();

    await expect(card.getByRole('heading')).toHaveText('Revenue');
    await expect(card).not.toContainText('USD');
    await expect(byTest(card, 'card-figure')).toHaveText('$2,400');
    await expect(overview.revenueRows(card)).toHaveText([
      'Ads$1,200 · 50%',
      'Sponsorship$600 · 25%',
      'Premium$400 · 17%',
      'Product sales$200 · 8%',
    ]);
  });
});
