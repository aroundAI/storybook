'use client';

import { FUNNEL_STAGE_LABEL, FUNNEL_STAGE_QUESTION } from '@kit/clickhouse';
import type { BenchmarkBand, StageDiagnosis } from '@kit/clickhouse';
import { cn } from '@kit/ui/utils';

import {
  BAND_LABEL,
  type StageSurface,
  formatSignalValue,
  notJudgableSentence,
} from '../../lib/signal-surface';

const BANDS: readonly BenchmarkBand[] = ['below', 'typical', 'above'];

/**
 * Depth 1: one cell per stage and one sentence (FILM-1719).
 *
 * This is the only place a band appears without its figures: it exists so
 * every stage can be scanned at once. Each kind of emptiness renders
 * differently, and only a judged stage has a meter — whose segments are a
 * fixed size, so no bar here can ever be drawn at zero length.
 */
export function StageStrip({
  stages,
  diagnosis,
}: {
  stages: readonly StageSurface[];
  diagnosis: StageDiagnosis;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ol
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
        aria-label="Funnel stages"
        data-test="stage-strip"
      >
        {stages.map((surface) => (
          <StageCell key={surface.stage} surface={surface} />
        ))}
      </ol>

      <div className="flex flex-col gap-1">
        <p
          className="text-base font-medium"
          data-test="signal-diagnosis"
          data-kind={diagnosis.kind}
        >
          {diagnosis.sentence}
        </p>
        <p
          className="text-sm text-muted-foreground"
          data-test="signal-coverage"
          data-judged-count={diagnosis.coverage.judgedCount}
          data-stage-count={diagnosis.coverage.stageCount}
        >
          {diagnosis.coverage.sentence}
        </p>
      </div>
    </div>
  );
}

function StageCell({ surface }: { surface: StageSurface }) {
  const label = FUNNEL_STAGE_LABEL[surface.stage];

  return (
    <li
      className={cn(
        'flex min-h-28 flex-col gap-2 rounded-xl border p-3',
        surface.state === 'judged' ? 'border-border' : 'border-dashed',
      )}
      data-test="stage-cell"
      data-stage={surface.stage}
      data-stage-state={surface.state}
      data-band={
        surface.state === 'judged' ? surface.benchmark.band : undefined
      }
      data-benchmark-state={
        surface.state === 'judged' ? surface.benchmark.state : undefined
      }
      title={FUNNEL_STAGE_QUESTION[surface.stage]}
    >
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <StageCellBody surface={surface} />
    </li>
  );
}

function StageCellBody({ surface }: { surface: StageSurface }) {
  switch (surface.state) {
    case 'unbound':
      return (
        <>
          <MutedRule />
          <span
            className="text-xs text-muted-foreground"
            data-test="stage-reason"
          >
            Not reported here. {surface.note}
          </span>
        </>
      );
    case 'dark':
      return (
        <>
          <MutedRule />
          <span
            className="text-xs text-muted-foreground"
            data-test="stage-reason"
          >
            {surface.gap === 'not_ingested'
              ? `Not collected yet: ${surface.blockers.join('; ')}.`
              : `${surface.blockers.join('; ')}.`}
          </span>
        </>
      );
    case 'not_judgable':
      return (
        <>
          {surface.value !== null && (
            <StageValue>
              {formatSignalValue(surface.signal, surface.value)}
            </StageValue>
          )}
          <span
            className="text-xs text-muted-foreground"
            data-test="stage-reason"
          >
            {notJudgableSentence(surface.why)}
          </span>
        </>
      );
    case 'insufficient_cohort':
      return (
        <>
          <StageValue>
            {formatSignalValue(surface.signal, surface.value)}
          </StageValue>
          <span
            className="text-xs text-muted-foreground"
            data-test="stage-reason"
          >
            {surface.reason === 'zero_baseline'
              ? `${surface.n} comparable videos, typical is zero`
              : `${surface.n} of ${surface.minPeers} comparable videos needed`}
          </span>
        </>
      );
    case 'judged':
      return (
        <>
          <span className="text-sm font-semibold" data-test="stage-band">
            {BAND_LABEL[surface.benchmark.band]}
          </span>
          <BandMeter band={surface.benchmark.band} />
          {surface.benchmark.state === 'directional' && (
            <span className="text-xs text-muted-foreground">Directional</span>
          )}
        </>
      );
  }
}

function StageValue({ children }: { children: string }) {
  return (
    <span
      className="text-lg font-semibold tabular-nums"
      data-test="stage-value"
    >
      {children}
    </span>
  );
}

/** A dashed rule where a figure would be: a stage with nothing to measure. */
function MutedRule() {
  return (
    <hr
      aria-hidden
      className="border-t border-dashed border-muted-foreground/40"
      data-test="stage-rule"
    />
  );
}

/** Three fixed segments, the band's filled: position, never magnitude. */
function BandMeter({ band }: { band: BenchmarkBand }) {
  return (
    <span
      className="flex gap-1"
      role="img"
      aria-label={`${BAND_LABEL[band]} the channel's typical range`}
      data-test="stage-band-meter"
    >
      {BANDS.map((segment) => (
        <span
          key={segment}
          className={cn(
            'h-1.5 w-6 rounded-full',
            segment === band ? 'bg-foreground' : 'bg-muted',
          )}
          data-bar={segment === band ? 'filled' : 'track'}
        />
      ))}
    </span>
  );
}
