'use client';

import { useMemo } from 'react';

import type { AnalyticsPlatform, MetricFamily } from '@kit/clickhouse';
import { badgeVariants } from '@kit/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import { cn } from '@kit/ui/utils';

import { platformLabel } from '../lib/platform-labels';
import {
  type ProvenanceChip as Chip,
  cardDimming,
  provenanceChip,
} from '../lib/provenance';
import { useCoverageView } from './coverage-context';
import {
  type CardMetricFamily,
  GENERATED_SOURCE,
  RECORDED_SOURCE,
} from './overview/card-claim';

export interface CardProvenance {
  chip: Chip;
  windowLabel: string;
  dimming: ReturnType<typeof cardDimming>;
}

/**
 * A figure no platform reported has no platform coverage to state. Its chip
 * says what kind of thing it is instead, so it cannot read as a measurement.
 */
const NOT_REPORTED_BY_A_PLATFORM = {
  recorded: { label: 'Recorded', text: RECORDED_SOURCE },
  generated: { label: 'Not measured', text: GENERATED_SOURCE },
} as const;

function familiesOf(metricFamily: CardMetricFamily): MetricFamily[] {
  if (metricFamily === 'recorded' || metricFamily === 'generated') return [];

  return typeof metricFamily === 'string' ? [metricFamily] : [...metricFamily];
}

/**
 * Everything a card says about its provenance (FILM-1705), from the
 * nearest `CoverageProvider`: the chip, and whether the platform filter
 * leaves it nothing to cover. Throws outside a provider.
 */
export function useCardProvenance(
  metricFamily: CardMetricFamily,
  platforms?: readonly AnalyticsPlatform[],
): CardProvenance {
  const view = useCoverageView();

  return useMemo(() => {
    const families = familiesOf(metricFamily);

    if (families.length === 0) {
      const { label, text } =
        NOT_REPORTED_BY_A_PLATFORM[metricFamily as 'recorded' | 'generated'];

      return {
        chip: {
          label,
          tone: 'native',
          muted: false,
          state: 'covered',
          lines: [],
          bodyLines: [],
          note: text,
        },
        windowLabel: view.windowLabel,
        dimming: { dimmed: false },
      };
    }

    return {
      chip: provenanceChip(view, families, platforms),
      windowLabel: view.windowLabel,
      dimming: cardDimming(families, view.selectedPlatforms, platforms),
    };
  }, [view, metricFamily, platforms]);
}

/**
 * The level is the dot's colour; the words stay in the text colour. The
 * badge's own warning and info variants colour the text too, and at this
 * size orange-500 and blue-500 on a card fail WCAG AA contrast — axe
 * flagged the MetricCards' chips.
 */
const DOT = {
  native: 'bg-muted-foreground',
  derived: 'bg-orange-500',
  partial: 'bg-blue-500',
} as const;

/**
 * The chip: "what does this number cover?" A badge whose colour is the
 * level — neutral, derived, partial — never a platform's brand colour, with
 * the per-platform explanation one click behind it.
 */
export function ProvenanceChip({
  provenance,
  title,
}: {
  provenance: CardProvenance;
  /** The card's title, for the button's accessible name. */
  title: string;
}) {
  const { chip, windowLabel } = provenance;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`What ${title} covers: ${chip.label}`}
          data-test="provenance-chip"
          data-coverage={chip.state}
          data-tone={chip.tone}
          data-muted={chip.muted ? 'true' : 'false'}
          className={cn(
            badgeVariants({ variant: 'outline' }),
            'shrink-0 gap-1.5 font-medium whitespace-nowrap',
            chip.muted && 'border-dashed text-muted-foreground',
          )}
        >
          <span
            aria-hidden
            className={cn('size-1.5 rounded-full', DOT[chip.tone])}
          />
          {chip.label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-80 flex-col gap-3 text-sm"
        data-test="provenance-chip-details"
      >
        <p className="text-xs font-medium text-muted-foreground">
          What this covers, for {windowLabel}
        </p>
        {chip.note ? (
          <p className="text-xs">{chip.note}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {chip.lines.map(({ platform, kind, text }) => (
              <li
                key={platform}
                className="flex flex-col gap-0.5 text-xs"
                data-test={`provenance-line-${platform}`}
                data-coverage={kind}
              >
                <span className="font-medium">{platformLabel(platform)}</span>
                {text.map((sentence) => (
                  <span key={sentence} className="text-muted-foreground">
                    {sentence}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The chip for a card that is not an `AnalyticsCard` — the MetricCards, the Audience cards. */
export function ProvenanceChipFor({
  metricFamily,
  platforms,
  title,
}: {
  metricFamily: CardMetricFamily;
  platforms?: readonly AnalyticsPlatform[];
  title: string;
}) {
  const provenance = useCardProvenance(metricFamily, platforms);

  return <ProvenanceChip provenance={provenance} title={title} />;
}
