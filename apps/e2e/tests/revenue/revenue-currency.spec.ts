import { expect, test } from '@playwright/test';

import { readRows, seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
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
    // The projection's window ends on the browser's date (KB-24), the one
    // this entry is dated in, so it counts whatever the hour: 5000 cents on
    // one day × 30. It used to be left unasserted, because east of UTC the
    // entry sat outside a window ending at the server's date.
    await expect(revenue.tileValues('projection')).toHaveText([
      '$24,000',
      '€1,500',
    ]);

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

/**
 * KB-23: a second currency for the same day overwrote the first.
 *
 * The action found the existing entry by scope, date and category — not
 * currency — so a $100 sponsorship saved after a €50 one replaced it, and
 * the form reported success. Asserted on the *second* submission, and again
 * after a reload, because that is where this form's bugs have lived
 * (FILM-1609); and on a third, the same-currency correction, which must
 * still replace rather than add.
 */
test.describe('Two currencies on one day (KB-23)', () => {
  test('a dollar entry after a euro entry keeps both; a second euro entry replaces the first', async ({
    page,
  }) => {
    const revenue = new RevenueCurrencyPageObject(page);
    const form = new RevenuePageObject(page);
    const team = await seedTeamAccount();

    await signInAs(page, team);
    await revenue.goToRevenue(team.slug);
    await revenue.openTab('manual');

    // The amount field is in the currency chosen, not always dollars.
    await expect(form.amountSymbol()).toHaveText('$');
    await form.chooseCurrency('EUR - Euro');
    await expect(form.amountSymbol()).toHaveText('€');
    await expect(page.getByText('Amount (EUR)')).toBeVisible();

    await form.addEntry({ dollars: '50.00', category: 'Sponsorship' });
    await form.expectSuccessToast();

    // Reset to the defaults, currency included.
    await expect(form.amountSymbol()).toHaveText('$');

    await form.addEntry({ dollars: '100.00', category: 'Sponsorship' });
    await expect(
      page.getByText('Revenue entry added successfully').last(),
    ).toBeVisible();

    await expect(revenue.tileValues('total')).toHaveText(['$100', '€50']);

    await page.reload();
    await expect(revenue.tileValues('total')).toHaveText(['$100', '€50']);

    const rows = await readRows<{ currency: string; revenue_cents: number }>(
      'revenue_records',
      `select=currency,revenue_cents&account_id=eq.${team.accountId}&order=currency`,
    );

    expect(rows).toEqual([
      { currency: 'EUR', revenue_cents: 5000 },
      { currency: 'USD', revenue_cents: 10000 },
    ]);

    // Same scope, date, category and currency: a correction, and said so.
    await revenue.openTab('manual');
    await form.chooseCurrency('EUR - Euro');
    await form.addEntry({ dollars: '60.00', category: 'Sponsorship' });
    await expect(
      page.getByText(
        /Revenue entry updated — this replaced the earlier EUR sponsorship figure for \d{4}-\d{2}-\d{2}/,
      ),
    ).toBeVisible();

    await expect(revenue.tileValues('total')).toHaveText(['$100', '€60']);
    expect(
      await readRows<{ currency: string; revenue_cents: number }>(
        'revenue_records',
        `select=currency,revenue_cents&account_id=eq.${team.accountId}&order=currency`,
      ),
    ).toEqual([
      { currency: 'EUR', revenue_cents: 6000 },
      { currency: 'USD', revenue_cents: 10000 },
    ]);
  });
});

/**
 * KB-24: the projection ended at the server's UTC date while an entry is
 * dated in the browser's, so east of UTC a just-saved figure projected to 0
 * until UTC's midnight caught up.
 *
 * Playwright cannot move the server's clock, so the same condition is made
 * from the browser's side: UTC+14, with the browser's clock at or after
 * 10:00 UTC — when Kiritimati is already on the next calendar day. The
 * browser is moved forward by at most ten hours, well inside the one day the
 * server accepts (FILM-1610's rule), and only when the real time is earlier.
 */
test.describe('The projection counts an entry saved today, east of UTC (KB-24)', () => {
  test.use({ timezoneId: 'Pacific/Kiritimati' });

  test("an entry dated the browser's today appears in the projection at once", async ({
    page,
  }) => {
    const revenue = new RevenueCurrencyPageObject(page);
    const form = new RevenuePageObject(page);
    const team = await seedTeamAccount();

    const now = new Date();
    const utcToday = now.toISOString().slice(0, 10);
    const tenUtc = new Date(`${utcToday}T10:05:00Z`);
    const localTomorrow = new Date(`${utcToday}T00:00:00Z`);
    localTomorrow.setUTCDate(localTomorrow.getUTCDate() + 1);

    await signInAs(page, team);
    await page.clock.setFixedTime(now > tenUtc ? now : tenUtc);
    await revenue.goToRevenue(team.slug);

    // A reload first: the date travels on every load, not just the first.
    // It is also what exposed a race in the page object — under a fixed
    // clock after a reload, the currency Select takes ~180ms to close and
    // hand focus back, and a calendar opened before then is dismissed by
    // that focus change. `chooseCurrency` now waits for it.
    await page.reload();
    await expect(revenue.tiles('total').first()).toBeVisible();
    await revenue.openTab('manual');

    await form.chooseCurrency('EUR - Euro');
    await form.addEntry({ dollars: '50.00', category: 'Sponsorship' });
    await form.expectSuccessToast();

    // The condition itself, so this cannot pass vacuously: the entry is
    // dated a day after the server's UTC date.
    const [row] = await readRows<{ record_date: string }>(
      'revenue_records',
      `select=record_date&account_id=eq.${team.accountId}`,
    );

    expect(row!.record_date).toBe(localTomorrow.toISOString().slice(0, 10));

    // 5000 cents on one day × 30. Before the fix: €0.
    await revenue.openTab('overview');
    await expect(revenue.tileValues('projection')).toHaveText(['€1,500']);
  });
});
