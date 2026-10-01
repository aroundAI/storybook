'use client';

import {
  EmptyState,
  EmptyStateHeading,
  EmptyStateText,
} from '@kit/ui/empty-state';

import { AnalyticsCard } from '../overview/analytics-card';
import type { CardClaim, CardMetricFamily } from '../overview/card-claim';

interface AudienceCardProps {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  /**
   * What the card shows. Required, as on every analytics card: the shell
   * draws the provenance chip from it (FILM-1705), and for a platform whose
   * audience is the account's rather than the asset's it says so in the
   * card (FILM-1707).
   */
  metricFamily: CardMetricFamily;
  /** The one figure and sentence the card leads with (FILM-1706). */
  claim: CardClaim;
  /** For a `not_collected` card: why, in place of the standing note. */
  provenanceNote?: string;
  /**
   * Only ever something derived from the rows the card shows: these used to
   * be canned sentences — "Male viewership has increased by 4.2%" — printed
   * whatever the data said (FILM-1701).
   */
  footerInsight?: React.ReactNode;
  children: React.ReactNode;
  'data-test'?: string;
}

/**
 * An Audience tab card: the one analytics shell (FILM-1707), with the
 * audience's figure as its claim and the breakdown as its evidence.
 */
export function AudienceCard({
  title,
  icon,
  metricFamily,
  claim,
  provenanceNote,
  footerInsight,
  children,
  'data-test': dataTest,
}: AudienceCardProps) {
  return (
    <AnalyticsCard
      title={title}
      icon={icon}
      metricFamily={metricFamily}
      provenanceNote={provenanceNote}
      claim={claim}
      details={null}
      footer={footerInsight}
      data-test={dataTest}
    >
      {children}
    </AnalyticsCard>
  );
}

/**
 * What a card shows instead of figures when it has no rows.
 *
 * Words, never a zero and never a stand-in: a zero is a measurement, and the
 * stand-ins this replaces were constants that read as one (FILM-1701).
 */
export function AudienceCardEmpty({
  heading = 'No data yet',
  children,
  'data-test': dataTest = 'audience-card-empty',
}: {
  heading?: string;
  children: React.ReactNode;
  'data-test'?: string;
}) {
  return (
    <EmptyState
      className="h-full min-h-48 border-border p-6 shadow-none"
      data-test={dataTest}
    >
      <EmptyStateHeading className="text-base font-semibold">
        {heading}
      </EmptyStateHeading>
      <EmptyStateText>{children}</EmptyStateText>
    </EmptyState>
  );
}
