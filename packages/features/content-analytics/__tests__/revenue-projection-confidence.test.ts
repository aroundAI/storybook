import { describe, expect, it } from 'vitest';

import {
  createRevenueProjectionFold,
  zeroRevenueProjection,
} from '../src/lib/revenue-by-currency';

/**
 * FILM-810. A projection's confidence is the number of days its own currency
 * has data for: under 14 is low, 14 to 24 is medium, 25 or more is high.
 */

function projectionFor(days: number, currency = 'USD') {
  const fold = createRevenueProjectionFold('2026-08-16');

  for (let day = 0; day < days; day++) {
    const date = new Date(Date.UTC(2026, 7, 1 + day));
    fold.add({
      record_date: date.toISOString().slice(0, 10),
      amount: { currency, cents: 100 },
    });
  }

  return fold.result()[0]!;
}

describe('projection confidence levels', () => {
  it.each([
    [1, 'low'],
    [13, 'low'],
    [14, 'medium'],
    [24, 'medium'],
    [25, 'high'],
    [30, 'high'],
  ] as const)('%i days of data is %s confidence', (days, level) => {
    const projection = projectionFor(days);

    expect(projection.basedOnDays).toBe(days);
    expect(projection.confidenceLevel).toBe(level);
  });

  it('counts days, not rows: two rows on one day are one day', () => {
    const fold = createRevenueProjectionFold('2026-08-16');

    for (let day = 0; day < 14; day++) {
      const record_date = new Date(Date.UTC(2026, 7, 1 + day))
        .toISOString()
        .slice(0, 10);
      fold.add({ record_date, amount: { currency: 'USD', cents: 100 } });
      fold.add({ record_date, amount: { currency: 'USD', cents: 50 } });
    }

    expect(fold.result()[0]).toMatchObject({
      basedOnDays: 14,
      confidenceLevel: 'medium',
    });
  });

  it('judges each currency by its own days', () => {
    const fold = createRevenueProjectionFold('2026-08-16');

    for (let day = 0; day < 25; day++) {
      fold.add({
        record_date: new Date(Date.UTC(2026, 7, 1 + day))
          .toISOString()
          .slice(0, 10),
        amount: { currency: 'USD', cents: 100 },
      });
    }
    fold.add({
      record_date: '2026-08-20',
      amount: { currency: 'EUR', cents: 5000 },
    });

    const byCurrency = Object.fromEntries(
      fold.result().map((p) => [p.currency, p.confidenceLevel]),
    );

    expect(byCurrency).toEqual({ USD: 'high', EUR: 'low' });
  });

  it('a currency with no rows is a low-confidence projection of nothing', () => {
    expect(zeroRevenueProjection('USD')).toMatchObject({
      basedOnDays: 0,
      confidenceLevel: 'low',
      estimatedMonthlyRevenueCents: 0,
    });
  });
});
