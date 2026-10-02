'use client';

import { MoreHorizontal } from 'lucide-react';

import type { MetricFamily } from '@kit/clickhouse';
import {
  EmptyState,
  EmptyStateHeading,
  EmptyStateText,
} from '@kit/ui/empty-state';

import { ProvenanceChipFor } from '../provenance-chip';

interface AudienceCardProps {
  /** Card title */
  title: string;
  /** Icon component */
  icon?: React.ComponentType<{ className?: string }>;
  /** Span 2 rows */
  rowSpan?: boolean;
  /**
   * What the card shows, for its provenance chip (FILM-1705). Absent only
   * for a card that shows nothing measured — the "we don't collect this"
   * slots.
   */
  metricFamily?: MetricFamily;
  /**
   * Footer text. Only ever something derived from the rows the card shows:
   * these used to be canned sentences — "Male viewership has increased by
   * 4.2%" — printed whatever the data said (FILM-1701).
   */
  footerInsight?: React.ReactNode;
  /** Children content */
  children: React.ReactNode;
  /** Optional className */
  className?: string;
  'data-test'?: string;
}

/**
 * Base card component for Audience tab - matches prototype design
 */
export function AudienceCard({
  title,
  icon: Icon,
  rowSpan = false,
  metricFamily,
  footerInsight,
  children,
  className = '',
  'data-test': dataTest,
}: AudienceCardProps) {
  const rowSpanClass = rowSpan ? 'row-span-2' : '';

  return (
    <div
      data-test={dataTest}
      className={`group flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 ${rowSpanClass} ${className}`}
    >
      {/* Card content */}
      <div className="flex flex-1 flex-col p-5">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            {Icon && <Icon className="h-5 w-5 text-blue-500" />}
            {title}
          </h3>
          <div className="flex items-center gap-2">
            {metricFamily && (
              <ProvenanceChipFor metricFamily={metricFamily} title={title} />
            )}
            <button className="text-gray-400 transition-colors hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1">{children}</div>
      </div>

      {/* Footer with insight */}
      {footerInsight && (
        <div className="border-t border-gray-200 bg-gray-50 px-5 py-3 dark:border-gray-800 dark:bg-white/5">
          <p className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
            {footerInsight}
          </p>
        </div>
      )}
    </div>
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
      className="h-full min-h-48 border-gray-200 p-6 shadow-none dark:border-gray-800"
      data-test={dataTest}
    >
      <EmptyStateHeading className="text-base font-semibold">
        {heading}
      </EmptyStateHeading>
      <EmptyStateText>{children}</EmptyStateText>
    </EmptyState>
  );
}
