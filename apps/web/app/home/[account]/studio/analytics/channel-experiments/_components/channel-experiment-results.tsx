'use client';

import type {
  ChannelExperimentResults,
  ExperimentEvidenceKind,
  MeasureCheckpointResult,
  StyleSummary,
} from '@kit/clickhouse';
import { EXPERIMENT_MEASURE_DEFINITIONS } from '@kit/clickhouse';
import type { ResultsState } from '@kit/content-analytics/server/channel-experiment-actions';
import { Badge } from '@kit/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';

type Unit =
  (typeof EXPERIMENT_MEASURE_DEFINITIONS)[keyof typeof EXPERIMENT_MEASURE_DEFINITIONS]['unit'];

export function formatMeasureValue(value: number, unit: Unit): string {
  switch (unit) {
    case 'views':
      return Math.round(value).toLocaleString('en-US');
    case 'ratio':
      return `${(value * 100).toFixed(1)}%`;
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'per_thousand':
      return value.toFixed(2);
  }
}

/**
 * What the figures may claim. While an experiment runs they are
 * associations; a concluded one was varied on purpose, and is the only kind
 * a causal claim elsewhere may cite — still without control of topic or
 * timing, so the page says that too.
 */
function EvidenceNote(props: {
  evidence: ExperimentEvidenceKind;
  asOf: string;
}) {
  if (props.evidence === 'concluded_experiment') {
    return (
      <p
        className={'rounded-md border bg-muted/40 p-3 text-sm'}
        data-test={'ce-evidence'}
        data-evidence={'concluded_experiment'}
      >
        Concluded experiment: results as they stood on {props.asOf.slice(0, 10)}
        . The styles were varied on purpose and assigned with a balancing
        suggestion, so a style ahead here is evidence that the style made a
        difference on this channel. Topic, timing and seasonality were still not
        controlled.
      </p>
    );
  }

  return (
    <p
      className={'rounded-md border bg-muted/40 p-3 text-sm'}
      data-test={'ce-evidence'}
      data-evidence={'association'}
    >
      These are associations between styles and outcomes on this channel, not
      proof of cause: topic, timing and seasonality are not controlled. Balanced
      assignment reduces that, but cannot rule it out. Figures are read live
      until the experiment is concluded.
    </p>
  );
}

function confidenceLabel(style: StyleSummary): string | null {
  if (style.confidence === 'directional') return 'early signal';
  if (style.confidence === 'insufficient') return 'too few';

  return null;
}

function Verdict(props: {
  result: MeasureCheckpointResult;
  names: Map<string, string>;
  testId: string;
}) {
  const { verdict } = props.result;
  const name = (id: string) => props.names.get(id) ?? 'A style';

  if (verdict.kind === 'too_few') {
    return (
      <p className={'text-sm text-muted-foreground'} data-test={props.testId}>
        No verdict yet: every style needs {verdict.threshold} measured videos.{' '}
        {verdict.needs
          .map((need) => `${name(need.styleId)} needs ${need.more} more`)
          .join('; ')}
        .
      </p>
    );
  }

  if (!verdict.anyClearDifference) {
    return (
      <p className={'text-sm'} data-test={props.testId}>
        No clear difference yet: every style&apos;s range overlaps the
        others&apos;.
      </p>
    );
  }

  const ahead = verdict.pairs.filter((pair) => pair.relation === 'ahead');

  return (
    <ul className={'list-disc pl-5 text-sm'} data-test={props.testId}>
      {ahead.map((pair) => (
        <li key={`${pair.styleId}-${pair.otherStyleId}`}>
          {name(pair.styleId)} is ahead of {name(pair.otherStyleId)}: their
          ranges do not overlap.
        </li>
      ))}
      <li className={'text-muted-foreground'}>
        Any pair not listed shows no clear difference yet.
      </li>
    </ul>
  );
}

function ResultTable(props: { result: MeasureCheckpointResult }) {
  const { result } = props;
  const definition = EXPERIMENT_MEASURE_DEFINITIONS[result.measure];
  const id = `${result.measure}-${result.checkpointDays}`;
  const names = new Map(result.styles.map((s) => [s.styleId, s.name]));

  return (
    <section className={'flex flex-col gap-2'} data-test={`ce-result-${id}`}>
      <h4 className={'text-sm font-medium'}>
        {definition.label}
        {result.measure === 'views' ? ` at ${result.checkpointDays} days` : ''}
      </h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Style</TableHead>
            <TableHead>Median</TableHead>
            <TableHead>Range (p25–p75)</TableHead>
            <TableHead>Measured</TableHead>
            <TableHead>Pending</TableHead>
            <TableHead>Not measurable</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.styles.map((style) => {
            const cell = (part: string) =>
              `ce-cell-${id}-${style.styleId}-${part}`;
            const label = confidenceLabel(style);

            return (
              <TableRow key={style.styleId}>
                <TableCell>
                  {style.name}{' '}
                  {label ? (
                    <Badge variant={'outline'} data-test={cell('confidence')}>
                      {label}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell data-test={cell('median')}>
                  {style.distribution
                    ? formatMeasureValue(
                        style.distribution.median,
                        definition.unit,
                      )
                    : '—'}
                </TableCell>
                <TableCell data-test={cell('range')}>
                  {style.distribution
                    ? `${formatMeasureValue(style.distribution.p25, definition.unit)} – ${formatMeasureValue(style.distribution.p75, definition.unit)}`
                    : '—'}
                </TableCell>
                <TableCell data-test={cell('measured')}>
                  {style.measured}
                </TableCell>
                <TableCell data-test={cell('pending')}>
                  {style.pending}
                </TableCell>
                <TableCell data-test={cell('unmeasurable')}>
                  {style.notMeasurable}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Verdict result={result} names={names} testId={`ce-verdict-${id}`} />
    </section>
  );
}

export function ChannelExperimentResultsView(props: {
  state: ResultsState;
  evidence: ExperimentEvidenceKind;
}) {
  const { state } = props;

  if (state.kind === 'not_started') {
    return (
      <p
        className={'text-sm text-muted-foreground'}
        data-test={'ce-results-not-started'}
      >
        Results start once the experiment is running and its videos reach 7 days
        old.
      </p>
    );
  }

  if (state.kind === 'analytics_off') {
    return (
      <p
        className={'text-sm text-muted-foreground'}
        data-test={'ce-results-off'}
      >
        Analytics are not available here, so no figures can be shown. That is
        not the same as zero; assignments are still recorded.
      </p>
    );
  }

  const results: ChannelExperimentResults = state.results;

  return (
    <div className={'flex flex-col gap-6'} data-test={'ce-results'}>
      <EvidenceNote evidence={props.evidence} asOf={results.asOf} />
      {results.results.map((result) => (
        <ResultTable
          key={`${result.measure}-${result.checkpointDays}`}
          result={result}
        />
      ))}
    </div>
  );
}
