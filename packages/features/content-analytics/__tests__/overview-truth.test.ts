import { describe, expect, it } from 'vitest';

import { ABSENT, type Measured, measured } from '../src/lib/measured';
import { mostDiscussed } from '../src/lib/most-discussed';
import {
  type ProjectRevenue,
  foldProjectRevenue,
} from '../src/lib/project-revenue';

/**
 * KB-16: what the Overview may say about comments and revenue, decided by
 * the rows rather than by a sentence typed into a component.
 */
describe('mostDiscussed', () => {
  const item = (title: string, comments: number) => ({ title, comments });

  it('names the item only when it really has the most comments', () => {
    expect(mostDiscussed([item('a', 3), item('b', 9), item('c', 1)])).toEqual(
      item('b', 9),
    );
  });

  it('names nothing when nobody commented', () => {
    // "X generated the most discussion" was rendered with 0 comments: the
    // reduce returned the first item whatever its count.
    expect(mostDiscussed([item('a', 0), item('b', 0)])).toBeNull();
    expect(mostDiscussed([])).toBeNull();
    expect(mostDiscussed(undefined)).toBeNull();
  });

  it('names nothing on a tie, because neither has "the most"', () => {
    expect(mostDiscussed([item('a', 4), item('b', 4)])).toBeNull();
  });

  it('a single commented item is the most discussed', () => {
    expect(mostDiscussed([item('a', 1)])).toEqual(item('a', 1));
  });
});

describe('foldProjectRevenue', () => {
  const row = (
    currency: string | null,
    cents: number,
    category: string,
    source = 'api',
  ) => ({
    platform: 'youtube',
    category,
    source,
    episode_id: null,
    amount: { currency, cents },
  });

  it('folds one mix per currency, largest first, never a sum', () => {
    const result = foldProjectRevenue([
      row('USD', 120_000, 'ads'),
      row('USD', 40_000, 'premium'),
      row('EUR', 60_000, 'sponsorship', 'manual'),
      row('EUR', 20_000, 'product', 'manual'),
    ]);

    expect(result).toEqual<ProjectRevenue[]>([
      {
        currency: 'USD',
        totalRevenueCents: 160_000,
        byType: { ads: 120_000, premium: 40_000 },
      },
      {
        currency: 'EUR',
        totalRevenueCents: 80_000,
        byType: { sponsorship: 60_000, product: 20_000 },
      },
    ]);
  });

  it('is empty when nothing was recorded — not a zero of dollars', () => {
    expect(foldProjectRevenue([])).toEqual([]);
  });

  it('reads a hand-typed payout category as other, like the account summary', () => {
    expect(foldProjectRevenue([row('USD', 500, 'ads', 'manual')])).toEqual([
      { currency: 'USD', totalRevenueCents: 500, byType: { other: 500 } },
    ]);
  });
});

describe('Measured', () => {
  it('cannot be absent and carry a value at once', () => {
    const present: Measured<number> = measured(3);
    const missing: Measured<number> = ABSENT;

    expect(present).toEqual({ kind: 'measured', value: 3 });
    expect(missing).toEqual({ kind: 'absent' });

    // @ts-expect-error an absent measurement has no value to read
    expect(missing.value).toBeUndefined();

    // @ts-expect-error a value must be declared measured; there is no default
    const bare: Measured<number> = 3;

    expect(bare).toBe(3);
  });
});
