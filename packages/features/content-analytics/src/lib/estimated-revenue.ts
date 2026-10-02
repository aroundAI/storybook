import { formatCurrency } from './format';

/**
 * A platform's estimated earnings as ClickHouse hands them back since
 * migration 022 (FILM-1726): US dollars in cents, or `null` where no day
 * behind the figure was measured. Null is "not measured", never $0: a
 * connection without YouTube's monetary scope, a channel outside the
 * Partner Program, and every TikTok, Instagram or Facebook video.
 *
 * Revenue a person entered is not this figure. It lives in Postgres
 * `revenue_records` with its own currency, and `./money` formats it.
 */
export type EstimatedRevenue = number | null;

export { addMeasured as addRevenue } from '@kit/clickhouse';

export const REVENUE_NOT_MEASURED = 'Not measured';

/** `$12.34`, or the not-measured label. */
export function formatRevenueCents(cents: EstimatedRevenue): string {
  return formatEstimatedRevenue(cents, (dollars) => `$${dollars.toFixed(2)}`);
}

/** Dollars, or the not-measured label. */
export function formatEstimatedRevenue(
  cents: EstimatedRevenue,
  format: (dollars: number) => string = formatCurrency,
): string {
  return cents === null ? REVENUE_NOT_MEASURED : format(cents / 100);
}
