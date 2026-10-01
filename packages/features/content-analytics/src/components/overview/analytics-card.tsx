'use client';

import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { ChevronRight, Info } from 'lucide-react';

import type { AnalyticsPlatform } from '@kit/clickhouse';
import { Collapsible, CollapsibleTrigger } from '@kit/ui/collapsible';
import { Separator } from '@kit/ui/separator';
import { Skeleton } from '@kit/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';
import { cn } from '@kit/ui/utils';

import type { ViewDefinitionMark } from '../../lib/view-definition-marks';
import { ProvenanceChip, useCardProvenance } from '../provenance-chip';
import {
  type CardClaim,
  type CardMetricFamily,
  sourceNotesFor,
} from './card-claim';

type NonEmpty<T> = readonly [T, ...T[]];

/**
 * Everything a card says beyond its claim, in a fixed order so the pattern
 * is learnable across every card. The lists are non-empty by type: a card
 * whose details are empty has failed FILM-1706, not passed it.
 */
export interface CardDetails {
  breakdown?: NonEmpty<{ label: string; value: string }>;
  /** Replaces the matrix-derived "where this comes from", when a card knows better. */
  source?: ReactNode;
  /** How the card's own figure is computed, in one sentence. */
  method?: string;
  caveats?: NonEmpty<ReactNode>;
}

interface AnalyticsCardProps {
  title: string;
  icon?: ComponentType<{ className?: string }>;
  /** A one-line tooltip. Anything longer belongs in `details`. */
  description?: string;
  /**
   * What the card shows. Required, so no card can be added without saying —
   * and the shell renders the provenance chip from it (FILM-1705), so no
   * card writes its own.
   */
  metricFamily: CardMetricFamily;
  /**
   * The platforms the figure can span, when narrower than its family for a
   * reason that is not coverage — the Partner Programme is one platform's.
   * Never a runtime list of who has rows: the coverage provider says that.
   */
  platforms?: readonly AnalyticsPlatform[];
  /**
   * For a card no platform reported (`generated`, `summary`, …): what it is
   * made from, in place of the standing note — a generated reading's
   * provenance is which numbers it was given and when (FILM-1707 §3).
   */
  provenanceNote?: string;
  /**
   * The figure is on a date axis, so fetch-dated rows are not in it
   * (FILM-1707 §2). The chip then names only what the card can plot, and
   * the card says which platforms it leaves out — when the project
   * publishes to any.
   */
  onDateAxis?: boolean;
  /** Where the chart crosses a change in what counts as a view (FILM-1722). */
  marks?: readonly ViewDefinitionMark[];
  claim: CardClaim | 'loading';
  /** `null` for a card that has nothing to say beyond its claim. */
  details?: CardDetails | null;
  colSpan?: 1 | 2;
  /** The evidence: a chart or list. Optional — some cards are their claim. */
  children?: ReactNode;
  /** Controls, not caveats — caveats go in `details`. */
  footer?: ReactNode;
  'data-test'?: string;
}

/**
 * The one card shell for every analytics tab (FILM-1706, FILM-1707).
 *
 * One claim per card, evidence one gesture away: an eyebrow, one figure
 * with one sentence, the chart, and a "Details" disclosure for breakdown,
 * source, method and caveats. On design-system tokens, so light and dark
 * need no hand-written pairs, and sized by its content.
 */
export function AnalyticsCard({
  title,
  icon: Icon,
  description,
  metricFamily,
  platforms,
  provenanceNote,
  onDateAxis,
  marks = [],
  claim,
  details,
  colSpan = 1,
  children,
  footer,
  'data-test': dataTest,
}: AnalyticsCardProps) {
  const titleId = useId();
  const provenance = useCardProvenance(metricFamily, platforms, {
    note: provenanceNote,
    onDateAxis,
  });
  const { chip, dimming, dateAxis } = provenance;
  // "Where this comes from" names the platforms the figure covers in this
  // window, once coverage says which; until then, those it can cover.
  const covered = chip.lines
    .filter(({ kind }) => kind === 'covered')
    .map(({ platform }) => platform);
  const sources = details?.source
    ? null
    : sourceNotesFor(
        metricFamily,
        covered.length > 0 ? covered : (dateAxis?.platforms ?? platforms),
      );
  // Said in the card, not only behind the chip: which platforms a date axis
  // leaves out, and what an account-level figure describes.
  const scopeLines = [
    ...(dateAxis?.sentence && dateAxis.platforms.length > 0
      ? [dateAxis.sentence]
      : []),
    ...chip.scopeLines,
  ];
  const hasDetails =
    details !== null &&
    Boolean(
      details?.breakdown ||
        details?.source ||
        details?.method ||
        details?.caveats ||
        (sources && sources.length > 0),
    );

  return (
    <section
      aria-labelledby={titleId}
      data-test={dataTest}
      data-card-shell={'analytics'}
      data-metric-family={
        typeof metricFamily === 'string'
          ? metricFamily
          : metricFamily.join(',')
      }
      data-date-axis={onDateAxis ? 'true' : undefined}
      data-dimmed={dimming.dimmed ? 'true' : undefined}
      className={cn(
        'flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm',
        colSpan === 2 && 'md:col-span-2',
        hasDetails && 'transition-colors hover:bg-accent/30',
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
          <h2
            id={titleId}
            className="truncate text-sm font-medium text-muted-foreground"
          >
            {title}
          </h2>
          {description && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`About ${title}`}
                  >
                    <Info className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs text-sm">{description}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <ProvenanceChip provenance={provenance} title={title} />
      </header>

      {dimming.dimmed && (
        <ul
          className="flex flex-col gap-1 text-xs text-muted-foreground"
          data-test="card-dimmed-reason"
        >
          {dimming.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      {/* Dimmed, never blanked: the figure is still what it covers. */}
      <div
        className={cn(
          'flex flex-1 flex-col gap-4',
          dimming.dimmed && 'opacity-50',
        )}
      >
        <Claim claim={claim} />

        {scopeLines.length > 0 && (
          <ul
            className="flex flex-col gap-1 text-xs text-muted-foreground"
            data-test="card-scope-note"
          >
            {scopeLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        {chip.bodyLines.length > 0 && (
          <ul
            className="flex flex-col gap-1 text-xs text-muted-foreground"
            data-test="card-coverage-note"
          >
            {chip.bodyLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        {children && <div className="flex flex-1 flex-col">{children}</div>}

        {marks.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {marks.map((mark) => (
              <li
                key={`${mark.platform}:${mark.date}`}
                className="flex items-start gap-1.5"
                data-test="view-definition-mark"
                data-date={mark.date}
                data-platform={mark.platform}
              >
                <span
                  aria-hidden
                  className="mt-1.5 h-0 w-3 shrink-0 border-t border-dashed border-current"
                />
                {mark.sentence}
              </li>
            ))}
          </ul>
        )}
      </div>

      {footer && (
        // A div, not a p: `footer` is ReactNode, and the Deep Dive median
        // card passes a row of buttons — a <div> inside a <p> is invalid.
        <div className="text-xs text-muted-foreground">{footer}</div>
      )}

      {hasDetails && details !== null && (
        <Disclosure
          title={title}
          details={details ?? {}}
          sources={sources}
          dataTest={dataTest}
        />
      )}
    </section>
  );
}

function Claim({ claim }: { claim: CardClaim | 'loading' }) {
  if (claim === 'loading') {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-48" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {claim.figure === null ? (
        <p
          className="text-sm font-medium text-muted-foreground"
          data-test="card-no-figure"
        >
          {claim.noFigure}
        </p>
      ) : (
        <p
          className="text-2xl font-semibold tracking-tight tabular-nums"
          data-test="card-figure"
        >
          {claim.figure}
        </p>
      )}
      <p className="text-sm text-muted-foreground" data-test="card-sentence">
        {claim.sentence}
      </p>
    </div>
  );
}

/**
 * The "Details" disclosure.
 *
 * Radix's `CollapsibleContent` renders nothing while closed, so browser
 * find could never reach a caveat. The region is ours instead, and stays
 * in the DOM: React renders it `hidden`, and once mounted it is upgraded
 * to `hidden="until-found"`, which lets find-in-page match inside it and
 * fire `beforematch` — the cue to open. Radix still owns the trigger, so
 * `aria-expanded` and the keyboard behave as its other disclosures do.
 */
function Disclosure({
  title,
  details,
  sources,
  dataTest,
}: {
  title: string;
  details: CardDetails;
  sources: string[] | null;
  dataTest?: string;
}) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const region = useRef<HTMLDivElement>(null);

  // A DOM event with no React prop, and an attribute value React cannot
  // express (it renders `hidden` as a boolean). Both need the element.
  useEffect(() => {
    const element = region.current;

    if (!element) return;

    if (!open) element.setAttribute('hidden', 'until-found');

    const reveal = () => setOpen(true);

    element.addEventListener('beforematch', reveal);

    return () => element.removeEventListener('beforematch', reveal);
  }, [open]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        aria-controls={regionId}
        className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        data-test={dataTest ? `${dataTest}-details-trigger` : undefined}
      >
        <ChevronRight
          aria-hidden
          className={cn('size-3.5 transition-transform', open && 'rotate-90')}
        />
        Details
      </CollapsibleTrigger>

      <div
        id={regionId}
        ref={region}
        role="region"
        aria-label={`${title} details`}
        hidden={!open}
        className="mt-3 flex flex-col gap-3 text-sm"
        data-test={dataTest ? `${dataTest}-details` : undefined}
      >
        {details.breakdown && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            {details.breakdown.map(({ label, value }) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {(details.source || (sources && sources.length > 0)) && (
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-medium">Where this comes from</h3>
            {details.source ? (
              <div className="text-xs text-muted-foreground">
                {details.source}
              </div>
            ) : (
              sources?.map((note) => (
                <p key={note} className="text-xs text-muted-foreground">
                  {note}
                </p>
              ))
            )}
          </div>
        )}

        {details.method && (
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-medium">How it’s computed</h3>
            <p className="text-xs text-muted-foreground">{details.method}</p>
          </div>
        )}

        {details.caveats && (
          <>
            <Separator />
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {details.caveats.map((caveat, index) => (
                <li key={index}>{caveat}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Collapsible>
  );
}
