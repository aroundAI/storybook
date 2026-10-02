'use client';

import { useMemo } from 'react';

import type { MetricFamily } from '@kit/clickhouse';
import { cn } from '@kit/ui/utils';

import {
  type StripKind,
  coverageStrip,
  filterAvailability,
} from '../lib/provenance';
import { useCoverageView } from './coverage-context';
import { type Platform, PlatformFilter } from './platform-filter';

/** Filled for data in the window, hollow for a platform that cannot have it. */
const DOT: Record<StripKind, string> = {
  covered: 'bg-primary',
  stale: 'bg-muted-foreground',
  no_data_in_window: 'bg-muted-foreground',
  not_authorised: 'bg-muted-foreground',
  unknown: 'border border-muted-foreground',
  pending: 'border border-muted-foreground',
  not_connected: 'border border-muted-foreground',
  not_ingested: 'border border-muted-foreground',
  not_reported: 'border border-muted-foreground',
  unsupported_platform: 'border border-muted-foreground',
};

/**
 * The strip: "why is my TikTok missing?" (FILM-1705 §2). One line under the
 * page header, one sentence per platform — connected, data in this window,
 * or why it cannot have any — answered once rather than on every card.
 *
 * It describes the window of the nearest `CoverageProvider`, so Deep Dive
 * mounts its own inside its own provider: its strip speaks for 52 weeks,
 * the header's for the picker's range.
 */
export function CoverageStrip({
  families,
  'data-test': dataTest = 'coverage-strip',
}: {
  /** The families the cards beneath it read. */
  families: readonly MetricFamily[];
  'data-test'?: string;
}) {
  const view = useCoverageView();
  const strip = useMemo(() => coverageStrip(view, families), [view, families]);

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      data-test={dataTest}
      data-window={view.windowLabel}
      aria-label={`Platform coverage for ${view.windowLabel}`}
      role="group"
    >
      <span className="font-medium text-foreground">
        Coverage, {view.windowLabel}
      </span>
      {strip.summary ? (
        <span data-test={`${dataTest}-summary`}>{strip.summary}</span>
      ) : (
        strip.items.map((item) => (
          <span
            key={item.platform}
            className="inline-flex items-center gap-1.5"
            data-test={`${dataTest}-${item.platform}`}
            data-kind={item.kind}
          >
            <span
              aria-hidden
              className={cn('size-2 shrink-0 rounded-full', DOT[item.kind])}
            />
            {item.sentence}
          </span>
        ))
      )}
    </div>
  );
}

/**
 * The platform filter, told which platforms the tab's cards can cover. A
 * platform they cannot is dimmed with the strip's own sentence as the
 * reason — never removed, and still selectable (FILM-1705 §3).
 */
export function CoveragePlatformFilter({
  families,
  selected,
  onChange,
}: {
  families: readonly MetricFamily[];
  selected: Platform[];
  onChange: (platforms: Platform[]) => void;
}) {
  const view = useCoverageView();
  const { available, reasons } = useMemo(
    () => filterAvailability(coverageStrip(view, families)),
    [view, families],
  );

  return (
    <PlatformFilter
      selected={selected}
      onChange={onChange}
      available={available}
      reasons={reasons}
    />
  );
}
