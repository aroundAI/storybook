/**
 * Money that may span currencies (KB-12).
 *
 * `revenue_records.currency` is a column, and a channel can be paid in more
 * than one — a sponsorship in euros beside AdSense in dollars. There are no
 * exchange rates in this system, so `$12.00` and `€5.00` are never `1700`
 * cents of anything: they are two amounts, listed.
 *
 * The rule lives here once. A reader of `revenue_records` gets a
 * `CurrencyAmount` rather than a bare number (`AccountRevenueRow.amount`),
 * folds with `createMoneyFold` or `createCurrencyPartition`, and renders
 * with `formatMoney` — so adding two amounts of unknown currency takes
 * reaching inside one on purpose, rather than being the default.
 *
 * Decided by the product owner, 2026-09-22: **one card per currency**. No
 * exchange rates, no base currency, no selector. An account with a single
 * currency sees exactly what it saw before.
 */

/**
 * One amount in one currency. `currency` is an ISO 4217 code, and null only
 * for a row written without one — kept as its own bucket, because guessing
 * it is dollars is the assumption this module exists to remove.
 */
export interface CurrencyAmount {
  currency: string | null;
  cents: number;
}

/**
 * `revenue_records.currency` defaults to this, the manual form opens on it,
 * and the sync writes it on every row. It is what an account with no
 * revenue at all is shown in — `$0`, as it always was — and nothing else:
 * a row that has a currency is never assumed to be in this one.
 */
export const DEFAULT_CURRENCY = 'USD';

/**
 * At most one amount per currency, in `compareCurrencyAmounts` order. Empty
 * when nothing was recorded — which is not the same as zero of something.
 */
export type MoneyByCurrency = CurrencyAmount[];

/**
 * The key a currency folds under. The schema accepts any three letters, so
 * `usd` and `USD` would otherwise become two cards for one currency.
 */
export function currencyKey(
  currency: string | null | undefined,
): string | null {
  const code = currency?.trim().toUpperCase();

  return code ? code : null;
}

/**
 * Largest first, then ISO code, then "not recorded" last — deterministic, so
 * a tie does not reorder cards between two renders of the same data.
 */
export function compareCurrencyAmounts(
  a: CurrencyAmount,
  b: CurrencyAmount,
): number {
  if (a.cents !== b.cents) return b.cents - a.cents;
  if (a.currency === b.currency) return 0;
  if (a.currency === null) return 1;
  if (b.currency === null) return -1;

  return a.currency < b.currency ? -1 : 1;
}

/**
 * Per-currency state for a fold that keeps more than one number — a summary
 * with its platform and category buckets, a series keyed by date.
 *
 * Everything inside one part is a single currency by construction, so the
 * arithmetic there is the arithmetic that was always written; what changed
 * is that it can no longer see a row from another currency.
 */
export function createCurrencyPartition<T>(init: () => T) {
  const parts = new Map<string | null, T>();

  return {
    for(currency: string | null | undefined): T {
      const key = currencyKey(currency);
      const existing = parts.get(key);

      if (existing !== undefined) return existing;

      const created = init();

      parts.set(key, created);

      return created;
    },

    /**
     * One entry per currency seen, ordered by `cents(part)` the way
     * `compareCurrencyAmounts` orders amounts.
     */
    entries(
      cents: (part: T) => number,
    ): Array<{ currency: string | null; part: T }> {
      return [...parts]
        .map(([currency, part]) => ({ currency, part }))
        .sort((a, b) =>
          compareCurrencyAmounts(
            { currency: a.currency, cents: cents(a.part) },
            { currency: b.currency, cents: cents(b.part) },
          ),
        );
    },
  };
}

/** The single fold: amounts in, one total per currency out. */
export function createMoneyFold() {
  const totals = createCurrencyPartition(() => ({ cents: 0 }));

  return {
    add(amount: CurrencyAmount): void {
      totals.for(amount.currency).cents += amount.cents;
    },

    result(): MoneyByCurrency {
      return totals
        .entries((total) => total.cents)
        .map(({ currency, part }) => ({ currency, cents: part.cents }));
    },
  };
}

export function foldMoney(amounts: Iterable<CurrencyAmount>): MoneyByCurrency {
  const fold = createMoneyFold();

  for (const amount of amounts) fold.add(amount);

  return fold.result();
}

export interface FormatAmountOptions {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

/**
 * The single formatter. Fraction digits default to the currency's own, and
 * a caller that has always rounded (the revenue tiles show whole dollars)
 * passes its own so a single-currency account reads exactly as before.
 */
export function formatCurrencyAmount(
  { currency, cents }: CurrencyAmount,
  options: FormatAmountOptions = {},
): string {
  const value = cents / 100;

  const plain = () =>
    value.toLocaleString('en-US', {
      minimumFractionDigits: options.minimumFractionDigits ?? 2,
      maximumFractionDigits: options.maximumFractionDigits ?? 2,
    });

  if (!currency) return `${plain()} (currency not recorded)`;

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      ...options,
    }).format(value);
  } catch {
    // An unrecognised code still shows its amount and its code.
    return `${plain()} ${currency}`;
  }
}

/** `$12.00 + €5.00` — amounts listed, never added. */
export function formatMoney(
  money: MoneyByCurrency,
  options?: FormatAmountOptions,
): string {
  return money
    .map((amount) => formatCurrencyAmount(amount, options))
    .join(' + ');
}

/** "USD", or how a card names the bucket of rows written without a code. */
export function currencyLabel(currency: string | null): string {
  return currency ?? 'Currency not recorded';
}

/**
 * The sign a currency's amounts are printed with — `$`, `€`, `CA$` — by the
 * same `Intl` rules `formatCurrencyAmount` uses, so the form's prefix and the
 * dashboard's figures agree. The code itself for one `Intl` does not know.
 */
export function currencySymbol(currency: string): string {
  try {
    return (
      new Intl.NumberFormat('en-US', { style: 'currency', currency })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? currency
    );
  } catch {
    return currency;
  }
}
