import { expect, test } from '@playwright/test';

import { RevenueCurrencyPageObject } from './revenue-currency.po';
import { RevenuePageObject } from './revenue.po';

/**
 * Revenue totals are per currency (KB-12).
 *
 * `revenue_records.currency` is a column and every reader used to add
 * `revenue_cents` without looking at it, so an account paid $1,600 and €800
 * was told "$2,400" — a figure in no currency. There are no exchange rates
 * here, so the answer is one card per currency, and an account with a
 * single currency sees exactly what it saw before.
 *
 * Seeded through the API (see revenue-currency.po.ts for the figures and the
 * arithmetic). ClickHouse is not needed: views are zero here, so RPM is $0 —
 * `revenue-currency-evidence.spec.ts` measures RPM against seeded views.
 */
test.describe('Revenue per currency', () => {
  test('an account paid in two currencies gets one card per currency, never a sum', async ({
    page,
  }) => {
    const revenue = new RevenueCurrencyPageObject(page);
    const { team } = await revenue.setup('EUR');

    await revenue.goToRevenue(team.slug);

    // Largest first. "$2,400" is the two added together.
    await expect(revenue.tileValues('total')).toHaveText(['$1,600', '€800']);

    // The trend is each currency against its own previous period: dollars
    // went 1,000 → 1,600, euros 0 → 800. Summed, it read +140.0%.
    await expect(
      page.locator('[data-test="revenue-tile-trend"]'),
    ).toContainText(['+60.0%', '+100.0%']);

    // 31 days in the default window: 160000/31 and 80000/31 cents.
    await expect(revenue.tileValues('daily')).toHaveText(['$52', '€26']);

    // One day with dollars, two with euros — the projection's own rule,
    // applied within a currency: 160000/1×30 and 80000/2×30 cents.
    await expect(revenue.tileValues('projection')).toHaveText([
      '$48,000',
      '€12,000',
    ]);

    // A share across currencies needs a rate nobody has. Each mix is over
    // its own currency: the dollars are all platform payouts, the euros
    // are none.
    await expect(revenue.mixCards()).toHaveCount(2);

    const [dollars, euros] = [
      revenue.mixCards().nth(0),
      revenue.mixCards().nth(1),
    ];

    await expect(dollars).toContainText('Ads');
    await expect(dollars).toContainText('$1,200 · 75%');
    await expect(dollars).toContainText('$400 · 25%');
    await expect(dollars).toContainText('100% of revenue comes from platform');
    await expect(dollars).not.toContainText('Sponsorship');

    await expect(euros).toContainText('€600 · 75%');
    await expect(euros).toContainText('€200 · 25%');
    await expect(euros).toContainText('0% of revenue comes from platform');
    await expect(euros).not.toContainText('Ads');

    // By platform: "% of total" is a share of that currency's total.
    await revenue.openTab('platforms');

    await expect(revenue.platformCards()).toContainText([
      /YouTube\s*\$1,600\s*100\.0% of total/,
      /YouTube\s*€600\s*75\.0% of total/,
      /Manual Entry\s*€200\s*25\.0% of total/,
    ]);

    // By content: a ranking across currencies is a ranking of nothing, so
    // the video is ranked once among the dollars and once among the euros.
    await revenue.openTab('content');

    await expect(revenue.topContentTables()).toHaveCount(2);
    await expect(
      revenue
        .topContentTables()
        .nth(0)
        .locator('[data-test="revenue-top-content-row"]'),
    ).toContainText(['$1,600']);
    await expect(
      revenue
        .topContentTables()
        .nth(1)
        .locator('[data-test="revenue-top-content-row"]'),
    ).toContainText(['€600']);
  });

  test('an account paid in one currency sees what it always saw', async ({
    page,
  }) => {
    const revenue = new RevenueCurrencyPageObject(page);
    const { team } = await revenue.setup('USD');

    await revenue.goToRevenue(team.slug);

    // Every string here was read off the page before the fix, from the same
    // seeded rows. One card of each kind, no currency named anywhere.
    await expect(revenue.tiles('total')).toHaveText(
      'Total Revenue$2,400+140.0% from previous period',
    );
    await expect(revenue.tiles('daily')).toHaveText('Daily Average$77per day');
    await expect(revenue.tiles('rpm')).toHaveText('RPM$0per 1,000 views');
    await expect(revenue.tiles('projection')).toHaveText(
      'Monthly Projection$24,000low confidence',
    );

    await expect(revenue.mixCards()).toHaveCount(1);
    await expect(revenue.mixCards()).toContainText('Revenue Mix');
    await expect(revenue.mixCards()).not.toContainText('USD');
    await expect(revenue.mixCards()).toContainText('$1,200 · 50%');
    await expect(revenue.mixCards()).toContainText('$600 · 25%');
    await expect(revenue.mixCards()).toContainText('$400 · 17%');
    await expect(revenue.mixCards()).toContainText('$200 · 8%');
    await expect(revenue.mixCards()).toContainText(
      '67% of revenue comes from platform',
    );

    await revenue.openTab('platforms');

    await expect(revenue.platformCards()).toHaveText([
      'YouTube$2,20091.7% of total',
      // The leading $ is the manual platform's icon, not an amount.
      '$Manual Entry$2008.3% of total',
    ]);

    await revenue.openTab('content');

    await expect(revenue.topContentTables()).toHaveCount(1);
    await expect(
      page.locator('[data-test="revenue-top-content-row"]'),
    ).toHaveText(['#1No imgSponsored videoyoutube0$2,200$0']);
  });

  test('a euro entry typed into a dollar account adds a euro card and leaves the dollars alone', async ({
    page,
  }) => {
    const revenue = new RevenueCurrencyPageObject(page);
    const form = new RevenuePageObject(page);
    const { team } = await revenue.setup('USD');

    await revenue.goToRevenue(team.slug);
    await expect(revenue.tileValues('total')).toHaveText(['$2,400']);

    // The one door a second currency has: a person, and this select.
    await revenue.openTab('manual');
    await form.chooseCurrency('EUR - Euro');
    await form.addEntry({ dollars: '50.00', category: 'Licensing' });
    await form.expectSuccessToast();

    // No reload: the save invalidates the summary. "$2,450" is the sum.
    await expect(revenue.tileValues('total')).toHaveText(['$2,400', '€50']);
    await expect(revenue.tiles('total')).toContainText([
      'Total Revenue · USD',
      'Total Revenue · EUR',
    ]);
    // The projection tile is deliberately not asserted here. Its window
    // ends at the *server's* UTC today while this entry is dated the
    // browser's today, so east of UTC the entry is outside it until UTC
    // catches up — a two-clock limit of the projection, not of KB-12.

    await revenue.openTab('overview');

    await expect(revenue.mixCards()).toHaveCount(2);
    await expect(revenue.mixCards().nth(1)).toContainText('Revenue Mix · EUR');
    await expect(revenue.mixCards().nth(1)).toContainText('€50 · 100%');
    // The dollar mix is what it was before the euro arrived.
    await expect(revenue.mixCards().nth(0)).toContainText('$1,200 · 50%');
    await expect(revenue.mixCards().nth(0)).toContainText(
      '67% of revenue comes from platform',
    );
  });
});
