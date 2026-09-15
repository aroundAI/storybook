/**
 * Splitting revenue into platform payouts and everything else (FILM-1609).
 *
 * Pure, because the rule is one line and the whole question is which side
 * of it a category falls on — which is exactly the thing that should be
 * asserted by a test rather than re-read out of a server action whenever a
 * category is added.
 */
import type { RevenueCategory } from './schemas/revenue.schema';
import {
  ManualRevenueCategorySchema,
  PLATFORM_PAYOUT_CATEGORIES,
} from './schemas/revenue.schema';

/**
 * Shape version stamped onto `revenue_reports.summary_data`.
 *
 * Bump this whenever a field in `RevenueSummary` changes *meaning* rather
 * than value. Version 2 is the first stamped one: `adsSharePercent` and
 * `nonAdSharePercent` moved from a signed denominator to positive buckets
 * only, so rows written before this carry the same keys with a different
 * definition. **Absence of the field identifies those rows** — they cannot
 * be migrated, because the inputs were not stored alongside them.
 *
 * The two definitions differ only where a category is negative, i.e. a
 * clawback month, which is exactly the case nobody would notice by eye.
 */
export const REVENUE_SUMMARY_SCHEMA_VERSION = 2;

/**
 * Categories the platform pays out, as opposed to income the channel
 * built itself.
 *
 * Closed and explicit. `adsRevenueCents` is the sum of these, never
 * `total − everything else`: the two have the same value today and
 * different values the moment a category is added that ought to count as
 * a payout, and only the explicit form forces that decision to be made
 * rather than inherited.
 */

/**
 * Every category the schema accepts, with its label.
 *
 * This is the *display* vocabulary — the mix card labels wedges from it.
 * What a person may type is `MANUAL_ENTRY_CATEGORIES` below, which is a
 * strict subset.
 *
 * One list, because there were three: this map, the mix card's labels, and
 * a hardcoded `<SelectItem>` list in the manual entry form. A vocabulary
 * kept in three places is a vocabulary that will be extended in two.
 */
export const REVENUE_CATEGORY_LABELS: Array<{
  value: RevenueCategory;
  label: string;
}> = [
  { value: 'sponsorship', label: 'Sponsorship' },
  { value: 'product', label: 'Product sales' },
  { value: 'affiliate', label: 'Affiliate' },
  { value: 'licensing', label: 'Licensing' },
  { value: 'ads', label: 'Ads' },
  { value: 'premium', label: 'Premium' },
  { value: 'other', label: 'Other' },
];

/**
 * The categories a person may enter by hand.
 *
 * `ads` and `premium` are excluded, and that is a correctness rule rather
 * than tidiness: `splitRevenueByPayout` counts every cent in those two as
 * a *platform payout*, with no way to tell a synced row from a typed one.
 * Offering them in the form let a hand-typed "Ads" entry inflate
 * `adsSharePercent` — the ad-share health signal this feature exists to
 * make measurable. They reach the table only through the sync
 * (`analytics-sync-cron.ts`), which is the only thing that knows they are
 * really platform payouts.
 */
export const MANUAL_ENTRY_CATEGORIES = REVENUE_CATEGORY_LABELS.filter(
  // Derived from the schema, not from two string literals. Naming them
  // here meant adding a third payout category would silently make it
  // hand-enterable — and the guard test named the same two literals, so it
  // would have stayed green while doing it.
  ({ value }) => ManualRevenueCategorySchema.safeParse(value).success,
);

/** Label for one category, for lookups keyed by the stored value. */
export const REVENUE_CATEGORY_LABEL: Record<string, string> =
  Object.fromEntries(
    REVENUE_CATEGORY_LABELS.map(({ value, label }) => [value, label]),
  );

/**
 * Distinct hues per category so the mix reads at a glance.
 *
 * `other` keeps `bg-muted-foreground`: it is the residual and should not
 * read as a first-class category.
 *
 * `licensing` takes a sixth chart token rather than sharing one at reduced
 * opacity. Sharing was the original plan, on the reasoning that the two
 * would sit at opposite ends of the bar — but wedges are sorted by value
 * (`:53-55`), so adjacency is data-dependent and two shades of one hue can
 * land side by side, reading as a single gradient wedge. `--chart-6` is
 * defined alongside the other five in `shadcn-ui.css`; a token that does
 * not resolve renders transparent, and a transparent wedge in a stacked
 * bar reads as missing revenue rather than as a styling bug.
 */
export const REVENUE_CATEGORY_COLOR: Record<string, string> = {
  ads: 'bg-chart-1',
  premium: 'bg-chart-2',
  sponsorship: 'bg-chart-3',
  product: 'bg-chart-4',
  affiliate: 'bg-chart-5',
  licensing: 'bg-chart-6',
  other: 'bg-muted-foreground',
};

export interface RevenueSplit {
  /** Platform payouts: ads + premium. */
  adsRevenueCents: number;
  /**
   * Everything the channel built itself — sponsorship, product, affiliate,
   * licensing, other. A falling ads share against this is the health
   * signal the mix card exists to show.
   */
  nonAdRevenueCents: number;
}

export interface RevenueMixView {
  /** Buckets the chart draws, positive only, largest first. */
  entries: Array<[string, number]>;
  /** Sum of those buckets — the denominator for every figure shown. */
  total: number;
  /** Payout share of `total`, in [0, 1]. */
  adShare: number;
  /** Negative buckets, excluded from the chart and disclosed beside it. */
  negatives: Array<[string, number]>;
}

/**
 * Payout share of revenue, in [0, 1].
 *
 * Over positive buckets only, on both sides of the division. A signed
 * total is not a denominator: with `{ ads: 10000, sponsorship: -8000 }`
 * the numerator is 10000 and a signed total is 2000, which reports the
 * share as 500%. Shared by the card and `getRevenueSummaryAction` so the
 * two cannot state different numbers for one metric — they did, and the
 * card was fixed alone.
 */
export function payoutShare(byType: Record<string, number>): number {
  const positive = Object.fromEntries(
    Object.entries(byType).filter(([, cents]) => cents > 0),
  );

  const total = Object.values(positive).reduce((sum, cents) => sum + cents, 0);

  if (total <= 0) return 0;

  return splitRevenueByPayout(positive, total).adsRevenueCents / total;
}

/**
 * Everything the mix card renders, derived once.
 *
 * Here rather than in the component because this share has now been wrong
 * twice in two different ways: first as `byType.ads / total`, which
 * disagreed with the server's ads+premium definition, and then as
 * `(ads + premium) / grossTotal`, where the numerator came from every
 * bucket and the denominator from the positive ones — so
 * `{ ads: 10000, sponsorship: -8000 }` rendered 500%, and a gross of zero
 * rendered 0% beside a full-width ads wedge.
 *
 * Numerator and denominator are drawn from the same positive-only set, so
 * the share cannot leave [0, 1] whatever the data does. Negative buckets
 * are reported rather than folded in: `revenue_cents` has no non-negative
 * CHECK and the YouTube sync writes what the API reports, so a clawback is
 * real and the card should say it is not counting it.
 */
export function revenueMixView(byType: Record<string, number>): RevenueMixView {
  const entries = Object.entries(byType)
    .filter(([, cents]) => cents > 0)
    .sort(([, a], [, b]) => b - a);

  const total = entries.reduce((sum, [, cents]) => sum + cents, 0);

  return {
    entries,
    total,
    adShare: payoutShare(byType),
    negatives: Object.entries(byType).filter(([, cents]) => cents < 0),
  };
}

export function splitRevenueByPayout(
  byType: Partial<Record<RevenueCategory, number>> | Record<string, number>,
  totalRevenueCents: number,
): RevenueSplit {
  const adsRevenueCents = PLATFORM_PAYOUT_CATEGORIES.reduce(
    (sum, category) => sum + (byType[category] ?? 0),
    0,
  );

  return {
    adsRevenueCents,
    nonAdRevenueCents: totalRevenueCents - adsRevenueCents,
  };
}
