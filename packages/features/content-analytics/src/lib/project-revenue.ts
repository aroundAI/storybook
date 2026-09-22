/**
 * A project's recorded revenue, one mix per currency (KB-16, KB-12).
 *
 * The Overview's revenue card drew "Ad Revenue" and "Sponsorships" as 70%
 * and 30% of a total, whatever was recorded. The real mix is the account
 * dashboard's (FILM-1609), folded here over the rows that belong to a
 * project's publishes — with `createRevenueSummaryFold`, so the category
 * rule and the per-currency partition are the ones the account summary
 * uses and not a second copy of them.
 */
import type { SummaryRevenueRow } from './revenue-by-currency';
import { createRevenueSummaryFold } from './revenue-by-currency';

export interface ProjectRevenue {
  /** ISO 4217, or null for rows written without a code. */
  currency: string | null;
  /** Every cent of `byType`, signed. */
  totalRevenueCents: number;
  /** Cents by category, in this currency only. */
  byType: Record<string, number>;
}

/** One entry per currency, largest first. Empty when nothing was recorded. */
export function foldProjectRevenue(
  rows: Iterable<SummaryRevenueRow>,
): ProjectRevenue[] {
  const fold = createRevenueSummaryFold();

  for (const row of rows) fold.add(row);

  // The summary's period and views feed fields this does not keep (RPM, the
  // daily average); the per-currency totals and mixes are unaffected.
  return fold
    .result({ period: { start: '', end: '' }, totalViews: 0 })
    .map(({ currency, totalRevenueCents, byType }) => ({
      currency,
      totalRevenueCents,
      byType,
    }));
}
