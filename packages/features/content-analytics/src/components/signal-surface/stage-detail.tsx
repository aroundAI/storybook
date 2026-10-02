'use client';

import type { ReactNode } from 'react';

import { FUNNEL_STAGE_LABEL, FUNNEL_STAGE_QUESTION } from '@kit/clickhouse';
import type { MetricProvenance, SignalId } from '@kit/clickhouse';

import {
  BAND_LABEL,
  type StagePeer,
  type StageSurface,
  formatLift,
  formatSignalValue,
  insufficientSentence,
  measureLine,
  notJudgableSentence,
  publishedDay,
  relaxedAxesSentence,
  signalDefinition,
  signalName,
} from '../../lib/signal-surface';
import { FindableDisclosure } from '../findable-disclosure';
import { VideoLink, type VideoLinkProps } from './video-link';

type Videos = VideoLinkProps['videos'];

/**
 * Depths 2 and 3 for one stage (FILM-1719). Below the strip a band never
 * appears alone: the measure line carries value, lift, typical and n
 * together, and the raw depth names the provider fields and ingestion path
 * and lists the peers the figure was compared with.
 */
export function StageDetail({
  surface,
  videos,
  onSelectVideo,
}: {
  surface: StageSurface;
  videos: Videos;
  onSelectVideo: (videoId: string) => void;
}) {
  const label = FUNNEL_STAGE_LABEL[surface.stage];

  return (
    <li
      className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0"
      data-test="stage-detail"
      data-stage={surface.stage}
      data-stage-state={surface.state}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">
          {label}{' '}
          <span className="font-normal text-muted-foreground">
            {FUNNEL_STAGE_QUESTION[surface.stage]}
          </span>
        </h4>
      </div>

      <FindableDisclosure
        label={'Measure'}
        regionLabel={`${label} measure`}
        triggerTestId="stage-measure-trigger"
        regionTestId="stage-measure"
      >
        <Measure surface={surface} />

        {(surface.state === 'judged' ||
          surface.state === 'insufficient_cohort' ||
          surface.state === 'not_judgable') && (
          <FindableDisclosure
            label={'Raw'}
            regionLabel={`${label} raw`}
            triggerTestId="stage-raw-trigger"
            regionTestId="stage-raw"
          >
            <Raw
              surface={surface}
              videos={videos}
              onSelectVideo={onSelectVideo}
            />
          </FindableDisclosure>
        )}
      </FindableDisclosure>
    </li>
  );
}

function Measure({ surface }: { surface: StageSurface }) {
  switch (surface.state) {
    case 'unbound':
      return <Line testId="stage-measure-line">{surface.note}</Line>;
    case 'dark':
      return (
        <>
          <Line testId="stage-measure-line">
            Primary signal: {signalName(surface.signal)}.{' '}
            {surface.gap === 'not_ingested'
              ? 'Its inputs are not collected yet.'
              : 'It is collected, but not yet read per video at a checkpoint.'}
          </Line>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {surface.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
          <Supporting signals={surface.supporting} />
        </>
      );
    case 'not_judgable':
      return (
        <>
          <Line testId="stage-measure-line">
            {surface.value === null
              ? `No ${signalName(surface.signal)} figure.`
              : `${formatSignalValue(surface.signal, surface.value)} ${signalName(surface.signal)} in the first ${surface.checkpointDays} days.`}{' '}
            {notJudgableSentence(surface.why)}
          </Line>
          <Supporting signals={surface.supporting} />
        </>
      );
    case 'insufficient_cohort':
      return (
        <>
          <Line testId="stage-measure-line">
            {formatSignalValue(surface.signal, surface.value)}{' '}
            {signalName(surface.signal)} in the first {surface.checkpointDays}{' '}
            days. {insufficientSentence(surface)}
          </Line>
          <Cohort axes={surface.relaxedAxes} />
          <Supporting signals={surface.supporting} />
        </>
      );
    case 'judged':
      return (
        <>
          <Line testId="stage-measure-line">
            {measureLine(surface.signal, surface.benchmark)}
          </Line>
          <p className="text-xs text-muted-foreground">
            {BAND_LABEL[surface.benchmark.band]} the middle half of comparable
            videos at {surface.checkpointDays} days (
            {formatSignalValue(surface.signal, surface.benchmark.cohortP25)} to{' '}
            {formatSignalValue(surface.signal, surface.benchmark.cohortP75)}
            ).{' '}
            {surface.benchmark.state === 'directional'
              ? 'Directional: enough comparable videos to compare, not yet an established pattern.'
              : 'Established: enough comparable videos for a stable comparison.'}
          </p>
          <Cohort axes={surface.benchmark.relaxedAxes} />
          <Supporting signals={surface.supporting} />
        </>
      );
  }
}

function Line({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <p className="text-sm tabular-nums" data-test={testId}>
      {children}
    </p>
  );
}

function Cohort({ axes }: { axes: readonly ('window' | 'language')[] }) {
  const relaxed = relaxedAxesSentence(axes);

  return (
    <p className="text-xs text-muted-foreground" data-test="stage-cohort">
      Compared with this channel’s earlier videos in the same format
      {relaxed ? ` (${relaxed})` : ''}.
    </p>
  );
}

function Supporting({ signals }: { signals: readonly SignalId[] }) {
  if (signals.length === 0) return null;

  return (
    <p className="text-xs text-muted-foreground" data-test="stage-supporting">
      Supporting signals: {signals.map(signalName).join(', ')}.
    </p>
  );
}

function Raw({
  surface,
  videos,
  onSelectVideo,
}: {
  surface: Extract<
    StageSurface,
    { state: 'judged' | 'insufficient_cohort' | 'not_judgable' }
  >;
  videos: Videos;
  onSelectVideo: (videoId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 text-xs">
      <Provenance provenance={surface.provenance} />

      {surface.state === 'judged' && (
        <dl
          className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1"
          data-test="stage-raw-figures"
        >
          <Term label="Value">
            {formatSignalValue(surface.signal, surface.benchmark.value)}
          </Term>
          <Term label="Observed lift">
            {formatLift(surface.benchmark.observedLift)}
          </Term>
          <Term label="Adjusted lift (shown)">
            {formatLift(surface.benchmark.adjustedLift)}
          </Term>
          <Term label="Typical (median)">
            {formatSignalValue(surface.signal, surface.benchmark.cohortMedian)}
          </Term>
          <Term label="Middle half">
            {formatSignalValue(surface.signal, surface.benchmark.cohortP25)} to{' '}
            {formatSignalValue(surface.signal, surface.benchmark.cohortP75)}
          </Term>
          <Term label="Comparable videos (n)">{surface.benchmark.n}</Term>
          <Term label="Checkpoint">{surface.checkpointDays} days</Term>
        </dl>
      )}

      {surface.state !== 'not_judgable' && (
        <Peers
          signal={surface.signal}
          peers={surface.peers}
          videos={videos}
          onSelectVideo={onSelectVideo}
        />
      )}
    </div>
  );
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </>
  );
}

function Provenance({ provenance }: { provenance: MetricProvenance }) {
  return (
    <div className="flex flex-col gap-1" data-test="stage-provenance">
      <p>
        <span className="font-medium">{signalName(provenance.signal)}</span>:{' '}
        {signalDefinition(provenance.signal)}
      </p>
      <ul className="flex flex-col gap-0.5" data-test="stage-provider-fields">
        {provenance.inputs.map((input) => (
          <li key={input.family}>
            Provider field
            {input.providerFields.length === 1 ? '' : 's'}{' '}
            <code>{input.providerFields.join(', ') || 'none recorded'}</code>
            {input.table ? (
              <>
                {' '}
                → <code>{input.table}</code>
              </>
            ) : null}{' '}
            ({input.level})
          </li>
        ))}
      </ul>
      <p data-test="stage-ingestion-path">
        Ingestion path: {provenance.ingestionPath}
      </p>
    </div>
  );
}

function Peers({
  signal,
  peers,
  videos,
  onSelectVideo,
}: {
  signal: Parameters<typeof formatSignalValue>[0];
  peers: readonly StagePeer[];
  videos: Videos;
  onSelectVideo: (videoId: string) => void;
}) {
  if (peers.length === 0) {
    return <p className="text-muted-foreground">No comparable videos.</p>;
  }

  const sorted = [...peers].sort((a, b) => b.value - a.value);

  return (
    <table className="w-full" data-test="stage-peers">
      <caption className="mb-1 text-left text-muted-foreground">
        The {peers.length} comparable video{peers.length === 1 ? '' : 's'}
      </caption>
      <thead className="sr-only">
        <tr>
          <th>Video</th>
          <th>Published</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((peer) => (
          <tr key={peer.videoId} data-test="stage-peer">
            <td className="py-0.5 pr-2">
              <VideoLink
                videoId={peer.videoId}
                videos={videos}
                onSelectVideo={onSelectVideo}
              />
            </td>
            <td className="pr-2 text-muted-foreground tabular-nums">
              {publishedDay(peer.publishedAt)}
            </td>
            <td className="text-right tabular-nums">
              {formatSignalValue(signal, peer.value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
