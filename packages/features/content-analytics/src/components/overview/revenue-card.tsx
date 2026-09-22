'use client';

import { DollarSign } from 'lucide-react';

import type { Measured } from '../../lib/measured';
import { formatCurrencyAmount } from '../../lib/money';
import type { ProjectRevenue } from '../../lib/project-revenue';
import {
  REVENUE_CATEGORY_COLOR,
  REVENUE_CATEGORY_LABEL,
  revenueMixView,
} from '../../lib/revenue-mix';
import { AnalyticsCard } from './analytics-card';

interface RevenueCardProps {
  /**
   * Recorded revenue for the project, one entry per currency, or `absent`
   * when it could not be read. Measured and empty means nothing was
   * recorded — which the card says, rather than showing a zero of dollars.
   */
  revenue: Measured<ProjectRevenue[]>;
}

const WHOLE_UNITS = { minimumFractionDigits: 0, maximumFractionDigits: 0 };
const MIX_AMOUNT = { minimumFractionDigits: 0, maximumFractionDigits: 2 };

/**
 * Revenue recorded against the project's videos, split by category —
 * the mix FILM-1609 computes for the account dashboard, per currency
 * (KB-12), instead of the fixed 70% "Ad Revenue" and 30% "Sponsorships"
 * this card used to draw whatever was recorded (KB-16).
 *
 * One card per currency: a share across two currencies needs an exchange
 * rate nobody has. An account paid in one currency sees one card, unnamed.
 */
export function RevenueCard({ revenue }: RevenueCardProps) {
  if (revenue.kind === 'absent') {
    return (
      <RevenueCardShell>
        <RevenueCardEmpty
          heading="Revenue isn’t available"
          data-test="overview-revenue-absent"
        >
          The recorded revenue for this project could not be read.
        </RevenueCardEmpty>
      </RevenueCardShell>
    );
  }

  if (revenue.value.length === 0) {
    return (
      <RevenueCardShell>
        <RevenueCardEmpty
          heading="No revenue recorded"
          data-test="overview-revenue-none"
        >
          Nothing was recorded against this project’s videos in this period.
        </RevenueCardEmpty>
      </RevenueCardShell>
    );
  }

  const named = revenue.value.length > 1;

  return (
    <>
      {revenue.value.map((entry) => (
        <RevenueCardShell
          key={entry.currency ?? 'none'}
          currency={named ? entry.currency : undefined}
        >
          <CurrencyRevenue entry={entry} />
        </RevenueCardShell>
      ))}
    </>
  );
}

function RevenueCardShell({
  currency,
  children,
}: {
  /** Named only when the project has more than one currency. */
  currency?: string | null;
  children: React.ReactNode;
}) {
  const title =
    currency === undefined
      ? 'Revenue'
      : `Revenue · ${currency ?? 'Currency not recorded'}`;

  return (
    <AnalyticsCard
      title={title}
      icon={DollarSign}
      description="Revenue recorded against this project’s videos in the selected period, by category"
      footer="Revenue recorded against this project’s videos. Channel-level income is on the account’s Revenue tab."
      data-test="overview-revenue"
    >
      {children}
    </AnalyticsCard>
  );
}

function CurrencyRevenue({ entry }: { entry: ProjectRevenue }) {
  const { currency, totalRevenueCents, byType } = entry;
  const formatCents = (cents: number, options = MIX_AMOUNT) =>
    formatCurrencyAmount({ currency, cents }, options);
  const { entries, total, negatives } = revenueMixView(byType);

  return (
    <div className="flex flex-col gap-3">
      <span
        className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white"
        data-test="overview-revenue-total"
      >
        {formatCents(totalRevenueCents, WHOLE_UNITS)}
      </span>

      {total > 0 ? (
        <div className="flex flex-col gap-1.5" data-test="overview-revenue-mix">
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            {entries.map(([category, cents]) => (
              <div
                key={category}
                className={
                  REVENUE_CATEGORY_COLOR[category] ?? 'bg-muted-foreground'
                }
                style={{ width: `${(cents / total) * 100}%` }}
              />
            ))}
          </div>
          {entries.map(([category, cents]) => (
            <div
              key={category}
              className="flex justify-between text-xs"
              data-test="overview-revenue-row"
              data-category={category}
            >
              <span className="text-gray-500 dark:text-gray-400">
                {REVENUE_CATEGORY_LABEL[category] ?? category}
              </span>
              <span className="font-medium text-gray-900 dark:text-white">
                {formatCents(cents)} · {Math.round((cents / total) * 100)}%
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {negatives.length > 0
            ? `No positive revenue this period — ${negatives.length} negative ${
                negatives.length === 1 ? 'adjustment' : 'adjustments'
              } only.`
            : 'Every row recorded this period is zero.'}
        </p>
      )}

      {negatives.length > 0 && total > 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Excludes {negatives.length} negative{' '}
          {negatives.length === 1 ? 'adjustment' : 'adjustments'}; the split
          covers positive revenue only.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Words where figures would be, and no zero: a zero is a measurement.
 * Collapses into FILM-1701's `NotCollectedCard` once #288 is on main.
 */
function RevenueCardEmpty({
  heading,
  children,
  'data-test': dataTest,
}: {
  heading: string;
  children: React.ReactNode;
  'data-test': string;
}) {
  return (
    <div className="flex flex-col gap-1" data-test={dataTest}>
      <span className="text-base font-semibold text-gray-900 dark:text-white">
        {heading}
      </span>
      <p className="text-xs text-gray-500 dark:text-gray-400">{children}</p>
    </div>
  );
}
