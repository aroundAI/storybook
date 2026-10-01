'use client';

import { useMemo } from 'react';

import {
  ANALYTICS_PLATFORMS,
  type AnalyticsPlatform,
  type MetricFamily,
} from '@kit/clickhouse';
import { badgeVariants } from '@kit/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import { cn } from '@kit/ui/utils';

import { platformLabel } from '../lib/platform-labels';
import {
  type ProvenanceChip as Chip,
  cardDimming,
  provenanceChip,
} from '../lib/provenance';
import {
  type DateAxisScope,
  dateAxisScope,
  fetchDatedSentence,
  isFetchDated,
} from '../lib/row-dating';
import { useCoverageView } from './coverage-context';
import {
  type CardMetricFamily,
  type NotFromAPlatform,
  isNotFromAPlatform,
  notFromAPlatformSource,
} from './overview/card-claim';

export interface CardProvenance {
  chip: Chip;
  windowLabel: string;
  dimming: ReturnType<typeof cardDimming>;
  /** For a figure on a date axis: which platforms it may plot, and what it leaves out. */
  dateAxis: DateAxisScope | null;
}

export interface CardProvenanceOptions {
  /**
   * Replaces the standing note of a card no platform reported — what a
   * generated reading was given and when, what a slot does not collect.
   */
  note?: string;
  /**
   * The figure sits on a date axis, so fetch-dated rows are not in it
   * (FILM-1707 §2): the chip names only the platforms it can plot, and the
   * card says which it left out.
   */
  onDateAxis?: boolean;
}

/**
 * A figure no platform reported has no platform coverage to state. Its chip
 * says what kind of thing it is instead, so it cannot read as a measurement.
 */
const NOT_FROM_A_PLATFORM_LABEL = {
  recorded: 'Recorded',
  generated: 'Not measured',
  summary: 'Page summary',
  not_collected: 'Not collected',
} as const satisfies Record<NotFromAPlatform, string>;

function familiesOf(metricFamily: CardMetricFamily): MetricFamily[] {
  if (isNotFromAPlatform(metricFamily)) return [];

  return typeof metricFamily === 'string' ? [metricFamily] : [...metricFamily];
}

/**
 * The chip of a date-axis card left with no platform it may plot — every
 * candidate reports running totals. Says so, rather than "Not reported",
 * which would be untrue of a platform that reports plenty.
 */
function nothingToPlot(candidates: readonly AnalyticsPlatform[]): Chip {
  const sentence = fetchDatedSentence(candidates);

  return {
    label: 'Not on a date axis',
    tone: 'partial',
    muted: true,
    state: 'unsupported',
    lines: [],
    bodyLines: [sentence],
    scopeLines: [],
    note: sentence,
  };
}

/**
 * Everything a card says about its provenance (FILM-1705), from the
 * nearest `CoverageProvider`: the chip, and whether the platform filter
 * leaves it nothing to cover. Throws outside a provider.
 */
export function useCardProvenance(
  metricFamily: CardMetricFamily,
  platforms?: readonly AnalyticsPlatform[],
  { note, onDateAxis = false }: CardProvenanceOptions = {},
): CardProvenance {
  const view = useCoverageView();

  return useMemo(() => {
    if (isNotFromAPlatform(metricFamily)) {
      return {
        chip: {
          label: NOT_FROM_A_PLATFORM_LABEL[metricFamily],
          tone: 'native',
          muted: false,
          state: 'covered',
          lines: [],
          bodyLines: [],
          scopeLines: [],
          note: note ?? notFromAPlatformSource(metricFamily),
        },
        windowLabel: view.windowLabel,
        dimming: { dimmed: false },
        dateAxis: null,
      };
    }

    const families = familiesOf(metricFamily);
    const dateAxis = onDateAxis
      ? dateAxisScope(
          platforms ?? ANALYTICS_PLATFORMS,
          (view.channels ?? []).map(({ platform }) => platform),
        )
      : null;

    if (dateAxis && dateAxis.platforms.length === 0) {
      return {
        chip: nothingToPlot(platforms ?? ANALYTICS_PLATFORMS),
        windowLabel: view.windowLabel,
        dimming: { dimmed: false },
        dateAxis,
      };
    }

    const plotted = dateAxis?.platforms ?? platforms;
    const dimming = cardDimming(families, view.selectedPlatforms, plotted);
    // Dimmed because the selection is only platforms a date axis leaves
    // out: say that, not "this card is about YouTube only".
    const fetchDated = view.selectedPlatforms.filter(isFetchDated);
    // The figure is the selected platforms' since FILM-1709 filters in the
    // query, so the chip speaks for those alone. A dimmed card keeps the
    // platforms it is about: its chip says what it would cover.
    const inFigure = (plotted ?? ANALYTICS_PLATFORMS).filter((platform) =>
      view.selectedPlatforms.includes(platform),
    );

    return {
      chip: provenanceChip(
        view,
        families,
        dimming.dimmed || inFigure.length === 0 ? plotted : inFigure,
      ),
      windowLabel: view.windowLabel,
      dimming:
        dateAxis && dimming.dimmed && fetchDated.length > 0
          ? { dimmed: true, reasons: [fetchDatedSentence(fetchDated)] }
          : dimming,
      dateAxis,
    };
  }, [view, metricFamily, platforms, note, onDateAxis]);
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
  note,
}: {
  metricFamily: CardMetricFamily;
  platforms?: readonly AnalyticsPlatform[];
  title: string;
  note?: string;
}) {
  const provenance = useCardProvenance(metricFamily, platforms, { note });

  return <ProvenanceChip provenance={provenance} title={title} />;
}
