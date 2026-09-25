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
import type { CardClaim } from './card-claim';

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
      <RevenueCardShell
        data-test="overview-revenue-absent"
        claim={{
          figure: null,
          noFigure: 'Revenue isn’t available',
          sentence: 'The recorded revenue for this project could not be read.',
        }}
      />
    );
  }

  if (revenue.value.length === 0) {
    return (
      <RevenueCardShell
        data-test="overview-revenue-none"
        claim={{
          figure: null,
          noFigure: 'No revenue recorded',
          sentence:
            'Nothing was recorded against this project’s videos in this period.',
        }}
      />
    );
  }

  const named = revenue.value.length > 1;

  return (
    <>
      {revenue.value.map((entry) => {
        const { negatives } = revenueMixView(entry.byType);

        return (
          <RevenueCardShell
            key={entry.currency ?? 'none'}
            currency={named ? entry.currency : undefined}
            claim={{
              figure: formatCurrencyAmount(
                { currency: entry.currency, cents: entry.totalRevenueCents },
                WHOLE_UNITS,
              ),
              sentence:
                'Revenue recorded against this project’s videos in the selected period.',
            }}
            negatives={negatives.length}
          >
            <CurrencyRevenue entry={entry} />
          </RevenueCardShell>
        );
      })}
    </>
  );
}

function RevenueCardShell({
  currency,
  claim,
  negatives = 0,
  children,
  'data-test': dataTest = 'overview-revenue',
}: {
  /** `overview-revenue` for a currency's card; its own id for an empty state. */
  'data-test'?: string;
  /** Named only when the project has more than one currency. */
  currency?: string | null;
  claim: CardClaim;
  /** Negative adjustments left out of the split. */
  negatives?: number;
  children?: React.ReactNode;
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
      metricFamily="recorded"
      claim={claim}
      details={{
        source:
          'Revenue recorded against this project’s videos. Channel-level income is on the account’s Revenue tab.',
        ...(negatives > 0
          ? {
              caveats: [
                `Excludes ${negatives} negative ${negatives === 1 ? 'adjustment' : 'adjustments'}; the split covers positive revenue only.`,
              ],
            }
          : {}),
      }}
      data-test={dataTest}
    >
      {children}
    </AnalyticsCard>
  );
}

function CurrencyRevenue({ entry }: { entry: ProjectRevenue }) {
  const { currency, byType } = entry;
  const formatCents = (cents: number, options = MIX_AMOUNT) =>
    formatCurrencyAmount({ currency, cents }, options);
  const { entries, total, negatives } = revenueMixView(byType);

  return total > 0 ? (
    <div className="flex flex-col gap-1.5" data-test="overview-revenue-mix">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
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
          <span className="text-muted-foreground">
            {REVENUE_CATEGORY_LABEL[category] ?? category}
          </span>
          <span className="font-medium tabular-nums">
            {formatCents(cents)} · {Math.round((cents / total) * 100)}%
          </span>
        </div>
      ))}
    </div>
  ) : (
    <p className="text-xs text-muted-foreground">
      {negatives.length > 0
        ? `No positive revenue this period — ${negatives.length} negative ${
            negatives.length === 1 ? 'adjustment' : 'adjustments'
          } only.`
        : 'Every row recorded this period is zero.'}
    </p>
  );
}
