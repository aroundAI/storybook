import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import { readRows, seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
import { RevenueCurrencyPageObject } from './revenue-currency.po';
import { RevenuePageObject } from './revenue.po';

/**
 * Screenshots and DOM measurements for KB-23 and KB-24.
 *
 * Not a guard — `revenue-currency.spec.ts` holds those. This captures the
 * states they assert, including the one after each save, and writes what it
 * read off the page to `kb-23-24-measured.json` for the PR.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('Revenue on one day — evidence (KB-23, KB-24)', () => {
  test.skip(!process.env.CAPTURE_EVIDENCE, 'Set CAPTURE_EVIDENCE=1.');

  test.use({
    viewport: { width: 1440, height: 1400 },
    timezoneId: 'Pacific/Kiritimati',
  });

  test('a euro entry, a dollar entry, a reload and a correction', async ({
    page,
  }) => {
    const revenue = new RevenueCurrencyPageObject(page);
    const form = new RevenuePageObject(page);
    const team = await seedTeamAccount();
    const measured: Record<string, unknown> = {};

    // As in the KB-24 guard: the browser's day is the server's UTC day + 1.
    const now = new Date();
    const tenUtc = new Date(`${now.toISOString().slice(0, 10)}T10:05:00Z`);

    await signInAs(page, team);
    await page.clock.setFixedTime(now > tenUtc ? now : tenUtc);
    await revenue.goToRevenue(team.slug);
    await revenue.openTab('manual');

    mkdirSync(OUT, { recursive: true });

    const tiles = async () => ({
      total: await revenue.tileValues('total').allTextContents(),
      projection: await revenue.tileValues('projection').allTextContents(),
    });

    await form.chooseCurrency('EUR - Euro');
    await form.fillAmount('50.00');
    await expect(form.amountSymbol()).toHaveText('€');
    await page.screenshot({ path: `${OUT}/kb23-01-euro-entry-typed.png` });

    await form.pickToday();
    await form.chooseCategory('Sponsorship');
    await form.submit();
    await form.expectSuccessToast();

    await form.addEntry({ dollars: '100.00', category: 'Sponsorship' });
    await expect(revenue.tileValues('total')).toHaveText(['$100', '€50']);
    await expect(revenue.tileValues('projection')).toHaveText([
      '$3,000',
      '€1,500',
    ]);
    await page.screenshot({ path: `${OUT}/kb23-02-after-second-save.png` });
    measured.afterSecondSave = await tiles();

    await page.reload();
    await expect(revenue.tileValues('total')).toHaveText(['$100', '€50']);
    await page.screenshot({ path: `${OUT}/kb23-03-after-reload.png` });
    measured.afterReload = await tiles();

    await revenue.openTab('manual');
    await form.chooseCurrency('EUR - Euro');
    await form.addEntry({ dollars: '60.00', category: 'Sponsorship' });
    await expect(page.getByText(/Revenue entry updated/)).toBeVisible();
    await expect(revenue.tileValues('total')).toHaveText(['$100', '€60']);
    await page.screenshot({ path: `${OUT}/kb23-04-after-correction.png` });
    measured.afterCorrection = await tiles();
    measured.toast = await page
      .getByText(/Revenue entry updated/)
      .textContent();

    measured.rows = await readRows(
      'revenue_records',
      `select=record_date,currency,revenue_cents,category&account_id=eq.${team.accountId}&order=currency`,
    );
    measured.browserToday = await page.evaluate(() => new Date().toString());
    measured.serverUtcToday = now.toISOString().slice(0, 10);

    writeFileSync(
      `${OUT}/kb-23-24-measured.json`,
      JSON.stringify(measured, null, 2),
    );
  });
});
