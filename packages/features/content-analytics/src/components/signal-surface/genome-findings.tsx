'use client';

import {
  EVIDENCE_LEVEL_LABEL,
  FUNNEL_STAGE_LABEL,
  evidenceLabel,
  recommendFrom,
} from '@kit/clickhouse';
import type {
  ComparableVideo,
  Evidence,
  FunnelStage,
  GenomeAnalysis,
  GenomeFinding,
  SegmentMeasure,
} from '@kit/clickhouse';
import { cn } from '@kit/ui/utils';

import {
  CLAIM_STRENGTH_LABEL,
  attributeName,
  backingSentence,
  claimSentence,
  formatLift,
  formatSignalValue,
  signalName,
} from '../../lib/signal-surface';
import { FindableDisclosure } from '../findable-disclosure';
import { VideoLink, type VideoLinkProps } from './video-link';

type Videos = VideoLinkProps['videos'];

/** Findings shown before the rest fold into "more": depth 1 stays scannable. */
const FIRST_FINDINGS = 3;

/**
 * FILM-1717's findings at each stage of this video's channel and format
 * (FILM-1719). Each claim is worded by its strength, a causal one only
 * beside the concluded test that established it, and every recommendation
 * renders inside the block that carries its evidence — there is no other
 * way onto the page for one.
 */
export function GenomeFindings({
  genome,
  subjectTags,
  videos,
  onSelectVideo,
}: {
  genome: Partial<Record<FunnelStage, GenomeAnalysis>>;
  subjectTags: readonly string[];
  videos: Videos;
  onSelectVideo: (videoId: string) => void;
}) {
  const analyses = Object.values(genome);

  if (analyses.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-test="genome-none">
        No stage of this format has a per-video measure the genome can read, so
        there are no creative findings to show.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-test="genome-findings">
      {analyses.map((analysis) => (
        <StageFindings
          key={analysis.stage}
          analysis={analysis}
          subjectTags={subjectTags}
          videos={videos}
          onSelectVideo={onSelectVideo}
        />
      ))}
    </div>
  );
}

function StageFindings({
  analysis,
  subjectTags,
  videos,
  onSelectVideo,
}: {
  analysis: GenomeAnalysis;
  subjectTags: readonly string[];
  videos: Videos;
  onSelectVideo: (videoId: string) => void;
}) {
  const label = FUNNEL_STAGE_LABEL[analysis.stage];
  const first = analysis.findings.slice(0, FIRST_FINDINGS);
  const rest = analysis.findings.slice(FIRST_FINDINGS);
  const render = (finding: GenomeFinding) => (
    <FindingCard
      key={`${finding.attribute.tag}`}
      finding={finding}
      carried={subjectTags.includes(finding.attribute.tag)}
      videos={videos}
      onSelectVideo={onSelectVideo}
    />
  );

  return (
    <section
      className="flex flex-col gap-3"
      data-test="genome-stage"
      data-stage={analysis.stage}
    >
      <div className="flex flex-col gap-0.5">
        <h4 className="text-sm font-medium">{label}</h4>
        <p className="text-xs text-muted-foreground">
          Scored on {signalName(analysis.signal)} at {analysis.checkpointDays}{' '}
          days across {analysis.measuredCount} measured video
          {analysis.measuredCount === 1 ? '' : 's'}
          {analysis.unmeasuredCount > 0
            ? `; ${analysis.unmeasuredCount} had no figure and are left out`
            : ''}
          .
        </p>
      </div>

      {analysis.findings.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-test="genome-empty">
          No mechanism separates this channel’s stronger videos from comparable
          weaker ones at this stage yet.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">{first.map(render)}</ul>
          {rest.length > 0 && (
            <FindableDisclosure
              label={`${rest.length} more finding${rest.length === 1 ? '' : 's'}`}
              regionLabel={`${label} more findings`}
              triggerTestId="genome-more-trigger"
            >
              <ul className="flex flex-col gap-3">{rest.map(render)}</ul>
            </FindableDisclosure>
          )}
        </>
      )}
    </section>
  );
}

function FindingCard({
  finding,
  carried,
  videos,
  onSelectVideo,
}: {
  finding: GenomeFinding;
  carried: boolean;
  videos: Videos;
  onSelectVideo: (videoId: string) => void;
}) {
  const { claim } = finding.evidence;
  const recommendation = recommendFrom(finding);

  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-4',
        claim.strength === 'causal' ? 'border-foreground/40' : 'border-border',
      )}
      data-test="genome-finding"
      data-strength={claim.strength}
      data-attribute={finding.attribute.tag}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-full border px-2 py-0.5 text-xs"
          data-test="genome-strength"
        >
          {CLAIM_STRENGTH_LABEL[claim.strength]}
        </span>
        {carried && (
          <span
            className="text-xs text-muted-foreground"
            data-test="genome-subject-has"
          >
            This video has it
          </span>
        )}
      </div>

      <p
        className={cn(
          'text-sm',
          claim.strength === 'causal' && 'font-medium',
          claim.strength === 'observed' && 'text-muted-foreground',
        )}
        data-test="genome-claim"
      >
        {claimSentence(finding)}
      </p>

      {claim.strength === 'causal' && (
        <p
          className="text-xs"
          data-test="genome-backing"
          data-backing-kind={claim.backing.kind}
        >
          Established by a {backingSentence(claim.backing)}.
        </p>
      )}

      <p className="text-sm" data-test="recommendation">
        {recommendation.sentence}
      </p>

      <EvidenceBlock
        finding={finding}
        videos={videos}
        onSelectVideo={onSelectVideo}
      />
    </li>
  );
}

/** The `Evidence` object, rendered: nothing a claim rests on is implied. */
function EvidenceBlock({
  finding,
  videos,
  onSelectVideo,
}: {
  finding: GenomeFinding;
  videos: Videos;
  onSelectVideo: (videoId: string) => void;
}) {
  const { evidence } = finding;
  const comparable = evidence.comparable;

  return (
    <div
      className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3 text-xs"
      data-test="evidence"
      data-level={evidence.level}
    >
      <p className="font-medium" data-test="evidence-label">
        {evidenceLabel(evidence)}
      </p>
      <p className="text-muted-foreground">
        {EVIDENCE_LEVEL_LABEL[evidence.level]}: {evidence.n} of{' '}
        {evidence.cohortN} comparable videos have{' '}
        {attributeName(finding.attribute)}
        {finding.inseparableFrom.length > 0
          ? ` (always together with ${finding.inseparableFrom.map(attributeName).join(', ')})`
          : ''}
        . Typical {signalName(evidence.signal)} is{' '}
        {formatSignalValue(evidence.signal, evidence.typical)}; with it,{' '}
        {formatSignalValue(evidence.signal, evidence.attributeMedian)}.
      </p>
      <p className="text-muted-foreground" data-test="evidence-comparable">
        Comparable means: same channel, {comparable.platform},{' '}
        {comparable.formatFamily.replaceAll('_', ' ')}
        {comparable.durationBand
          ? `, ${comparable.durationBand.replaceAll('_', ' ')} long`
          : ''}
        {comparable.topic ? `, topic ${comparable.topic}` : ''}, at{' '}
        {comparable.checkpointDays} days.
      </p>

      {finding.testedBy.length > 0 && (
        <ul className="flex flex-col gap-0.5" data-test="evidence-tested-by">
          {finding.testedBy.map((test) => (
            <li key={`${test.kind}:${test.id}`}>
              Tested: {backingSentence(test.backing)}, {test.outcome}.
            </li>
          ))}
        </ul>
      )}

      <ComparableSet
        title={`${evidence.successful.length} with it that did better than typical`}
        testId="comparable-successful"
        set={evidence.successful}
        signal={evidence.signal}
        videos={videos}
        onSelectVideo={onSelectVideo}
      />
      <ComparableSet
        title={`${evidence.unsuccessful.length} with it that did worse than typical`}
        testId="comparable-unsuccessful"
        set={evidence.unsuccessful}
        signal={evidence.signal}
        videos={videos}
        onSelectVideo={onSelectVideo}
      />

      <FindableDisclosure
        label={'Raw'}
        regionLabel={`${attributeName(finding.attribute)} raw evidence`}
        triggerTestId="evidence-raw-trigger"
        className="text-xs"
      >
        <RawEvidence evidence={evidence} />
      </FindableDisclosure>
    </div>
  );
}

function ComparableSet({
  title,
  testId,
  set,
  signal,
  videos,
  onSelectVideo,
}: {
  title: string;
  testId: string;
  set: readonly ComparableVideo[];
  signal: SegmentMeasure;
  videos: Videos;
  onSelectVideo: (videoId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1" data-test={testId}>
      <p className="font-medium">{title}</p>
      {set.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {set.map((video) => (
            <li key={video.videoId} className="flex justify-between gap-2">
              <VideoLink
                videoId={video.videoId}
                videos={videos}
                onSelectVideo={onSelectVideo}
              />
              <span className="tabular-nums">
                {formatSignalValue(signal, video.value)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RawEvidence({ evidence }: { evidence: Evidence }) {
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Observed lift</dt>
        <dd className="tabular-nums">{formatLift(evidence.observedLift)}</dd>
        <dt className="text-muted-foreground">Adjusted lift (shown)</dt>
        <dd className="tabular-nums">{formatLift(evidence.adjustedLift)}</dd>
        <dt className="text-muted-foreground">Shrinkage factor</dt>
        <dd className="tabular-nums">{evidence.shrinkageFactor.toFixed(2)}</dd>
        <dt className="text-muted-foreground">Source rows</dt>
        <dd className="tabular-nums">{evidence.sourceRows.length}</dd>
      </dl>
      <p data-test="evidence-provenance">
        {signalName(evidence.provenance.signal)} from{' '}
        {evidence.provenance.inputs
          .map((input) => input.providerFields.join(', '))
          .join('; ')}
        . Ingestion path: {evidence.provenance.ingestionPath}
      </p>
    </div>
  );
}
