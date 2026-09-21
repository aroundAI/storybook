import { describe, expect, it } from 'vitest';

import {
  createCurrencyPartition,
  foldMoney,
  formatCurrencyAmount,
  formatMoney,
} from '../src/lib/money';
import { AddManualRevenueSchema } from '../src/lib/schemas/revenue.schema';
import type { AccountRevenueRow } from '../src/server/revenue-queries';

describe('foldMoney', () => {
  it('never adds two currencies together', () => {
    // 1700 is what every reader used to report: cents of nothing.
    expect(
      foldMoney([
        { currency: 'USD', cents: 1200 },
        { currency: 'EUR', cents: 500 },
      ]),
    ).toEqual([
      { currency: 'USD', cents: 1200 },
      { currency: 'EUR', cents: 500 },
    ]);
  });

  it('adds within a currency', () => {
    expect(
      foldMoney([
        { currency: 'USD', cents: 1200 },
        { currency: 'EUR', cents: 500 },
        { currency: 'USD', cents: 300 },
      ]),
    ).toEqual([
      { currency: 'USD', cents: 1500 },
      { currency: 'EUR', cents: 500 },
    ]);
  });

  it('is empty, not zero dollars, when nothing was recorded', () => {
    expect(foldMoney([])).toEqual([]);
  });

  it('folds a code written in another case into the same currency', () => {
    // The schema accepts any three letters; `usd` must not become a second
    // card beside `USD`.
    expect(
      foldMoney([
        { currency: 'usd', cents: 100 },
        { currency: 'USD', cents: 200 },
      ]),
    ).toEqual([{ currency: 'USD', cents: 300 }]);
  });

  it('keeps rows written without a currency apart, rather than calling them dollars', () => {
    expect(
      foldMoney([
        { currency: null, cents: 900 },
        { currency: 'USD', cents: 100 },
      ]),
    ).toEqual([
      { currency: null, cents: 900 },
      { currency: 'USD', cents: 100 },
    ]);
  });

  it('orders largest first, then by code, then unrecorded last', () => {
    expect(
      foldMoney([
        { currency: null, cents: 500 },
        { currency: 'USD', cents: 500 },
        { currency: 'GBP', cents: 9000 },
        { currency: 'EUR', cents: 500 },
      ]).map(({ currency }) => currency),
    ).toEqual(['GBP', 'EUR', 'USD', null]);
  });
});

describe('createCurrencyPartition', () => {
  it('hands each currency its own state and orders it like amounts', () => {
    const parts = createCurrencyPartition(() => ({ days: 0, cents: 0 }));

    parts.for('EUR').cents += 500;
    parts.for('USD').cents += 1200;
    parts.for('eur').days += 1;

    expect(parts.entries((part) => part.cents)).toEqual([
      { currency: 'USD', part: { days: 0, cents: 1200 } },
      { currency: 'EUR', part: { days: 1, cents: 500 } },
    ]);
  });
});

describe('formatMoney', () => {
  it('lists each amount in its own currency', () => {
    expect(
      formatMoney([
        { currency: 'USD', cents: 1200 },
        { currency: 'EUR', cents: 500 },
      ]),
    ).toBe('$12.00 + €5.00');
  });

  it('reads as it always did for one currency', () => {
    expect(formatMoney([{ currency: 'USD', cents: 1200 }])).toBe('$12.00');
  });

  it('rounds the way a caller that always rounded asks it to', () => {
    // The revenue tiles have always shown whole dollars.
    expect(
      formatCurrencyAmount(
        { currency: 'USD', cents: 160_000 },
        { minimumFractionDigits: 0, maximumFractionDigits: 0 },
      ),
    ).toBe('$1,600');
  });

  it('says so when no currency was recorded', () => {
    expect(formatCurrencyAmount({ currency: null, cents: 950 })).toBe(
      '9.50 (currency not recorded)',
    );
  });

  it('still shows an amount and its code for a code Intl rejects', () => {
    expect(formatCurrencyAmount({ currency: 'E$', cents: 950 })).toBe(
      '9.50 E$',
    );
  });
});

describe('AccountRevenueRow', () => {
  it('carries an amount with its currency, and no bare cents to add', () => {
    const row = {} as AccountRevenueRow;

    // Typechecked with the rest of `__tests__`: if `revenue_cents` comes
    // back as a plain number, `tsc` fails here. Two `amount`s cannot be
    // added either — `+` does not apply to objects.
    // @ts-expect-error a revenue row has no currency-less figure
    expect(row.revenue_cents).toBeUndefined();
    // @ts-expect-error nor a currency detached from its amount
    expect(row.currency).toBeUndefined();
  });
});

describe('AddManualRevenueSchema', () => {
  it('stores a currency code upper-case, so one currency is one group in SQL', () => {
    // The Video Log groups by `currency` in the database, where `eur` and
    // `EUR` are two values; the form only offers upper-case, but the form
    // is not the only caller of a server action.
    const parsed = AddManualRevenueSchema.parse({
      accountId: '7b0d3f0e-6f59-4c1e-9d5f-0e8a1c2b3d4e',
      date: '2026-09-01',
      revenueCents: 500,
      currency: 'eur',
    });

    expect(parsed.currency).toBe('EUR');
  });
});
