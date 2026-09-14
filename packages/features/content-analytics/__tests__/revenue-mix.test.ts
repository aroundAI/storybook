import { describe, expect, it } from 'vitest';

import {
  REVENUE_CATEGORY_COLOR,
  REVENUE_CATEGORY_LABELS,
  splitRevenueByPayout,
} from '../src/lib/revenue-mix';
import { RevenueCategorySchema } from '../src/lib/schemas/revenue.schema';

describe('RevenueCategorySchema', () => {
  it('accepts licensing', () => {
    expect(RevenueCategorySchema.parse('licensing')).toBe('licensing');
  });

  it('still rejects a category outside the vocabulary', () => {
    // The vocabulary is closed because `category` is part of
    // idx_revenue_records_unique_scope: two spellings of one category
    // would occupy two rows for one day and one scope.
    expect(() => RevenueCategorySchema.parse('Licensing')).toThrow();
    expect(() => RevenueCategorySchema.parse('sponsorships')).toThrow();
  });
});

describe('splitRevenueByPayout', () => {
  it('counts ads and premium as platform payouts', () => {
    const split = splitRevenueByPayout({ ads: 600, premium: 400 }, 1000);

    expect(split.adsRevenueCents).toBe(1000);
    expect(split.nonAdRevenueCents).toBe(0);
  });

  it('counts licensing as non-ad revenue', () => {
    const split = splitRevenueByPayout({ ads: 600, licensing: 400 }, 1000);

    expect(split.adsRevenueCents).toBe(600);
    expect(split.nonAdRevenueCents).toBe(400);
  });

  it('sums the payout categories rather than subtracting from the total', () => {
    // `total − everything else` has the same value today and a different
    // one the moment a category is added that should count as a payout.
    // A total that disagrees with its parts must not silently become ads.
    const split = splitRevenueByPayout({ ads: 100 }, 1_000_000);

    expect(split.adsRevenueCents).toBe(100);
  });

  it('puts every non-payout category on the non-ad side', () => {
    const split = splitRevenueByPayout(
      {
        sponsorship: 100,
        product: 100,
        affiliate: 100,
        licensing: 100,
        other: 100,
      },
      500,
    );

    expect(split.adsRevenueCents).toBe(0);
    expect(split.nonAdRevenueCents).toBe(500);
  });

  it('treats an absent category as zero rather than NaN', () => {
    expect(splitRevenueByPayout({}, 0)).toEqual({
      adsRevenueCents: 0,
      nonAdRevenueCents: 0,
    });
  });
});

describe('REVENUE_CATEGORY_LABELS', () => {
  it('covers every category the schema accepts, and no others', () => {
    // The list drives the manual entry form's options and the mix card's
    // labels. A category the schema accepts but this omits is one a user
    // can never select; one this has and the schema rejects is an option
    // that fails on submit.
    const listed = REVENUE_CATEGORY_LABELS.map((entry) => entry.value).sort();
    const accepted = [...RevenueCategorySchema.options].sort();

    expect(listed).toEqual(accepted);
  });

  it('offers licensing', () => {
    expect(
      REVENUE_CATEGORY_LABELS.some((entry) => entry.value === 'licensing'),
    ).toBe(true);
  });

  it('lists no category twice', () => {
    const values = REVENUE_CATEGORY_LABELS.map((entry) => entry.value);

    expect(new Set(values).size).toBe(values.length);
  });
});

describe('REVENUE_CATEGORY_COLOR', () => {
  /**
   * Tokens the theme actually defines. `--chart-1..6` are declared in all
   * three blocks of `apps/web/styles/shadcn-ui.css` and mapped to
   * `--color-chart-N` in `theme.css`; a `bg-chart-*` class whose token is
   * missing resolves to nothing and renders transparent, which in a
   * stacked bar reads as missing revenue rather than as a styling bug.
   */
  const DEFINED_TOKENS = [
    'bg-chart-1',
    'bg-chart-2',
    'bg-chart-3',
    'bg-chart-4',
    'bg-chart-5',
    'bg-chart-6',
    'bg-muted-foreground',
  ];

  it('gives every category a colour', () => {
    for (const { value } of REVENUE_CATEGORY_LABELS) {
      expect(REVENUE_CATEGORY_COLOR[value]).toBeDefined();
    }
  });

  it('uses only tokens the theme defines', () => {
    for (const { value } of REVENUE_CATEGORY_LABELS) {
      expect(DEFINED_TOKENS).toContain(REVENUE_CATEGORY_COLOR[value]);
    }
  });

  it('gives each named category its own hue', () => {
    // `other` is the residual and deliberately shares nothing; the six
    // named categories must be distinguishable from each other.
    const named = REVENUE_CATEGORY_LABELS.filter(
      ({ value }) => value !== 'other',
    ).map(({ value }) => REVENUE_CATEGORY_COLOR[value]);

    expect(new Set(named).size).toBe(named.length);
  });

  it('keeps other visually distinct from the named categories', () => {
    expect(REVENUE_CATEGORY_COLOR.other).toBe('bg-muted-foreground');
  });
});
