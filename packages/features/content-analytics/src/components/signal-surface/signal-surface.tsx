'use client';

import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Skeleton } from '@kit/ui/skeleton';

import { publishedDay } from '../../lib/signal-surface';
import { getSignalSurfaceAction } from '../../server/signal-surface-actions';
import type { SignalSurfaceResult } from '../../server/signal-surface-service';
import { GenomeFindings } from './genome-findings';
import { StageDetail } from './stage-detail';
import { StageStrip } from './stage-strip';

const DEFAULT_CHECKPOINT = 30;

/**
 * One video's signals, at three depths (FILM-1719).
 *
 * 1. Verdict: the stage strip and one sentence, with how many stages it
 *    was judged on.
 * 2. Measure: per stage, the figure with its lift, typical and n.
 * 3. Raw: the provider fields, the ingestion path and the peers.
 *
 * Depths 2 and 3 are disclosures whose content stays in the DOM, so browser
 * find and copy reach every figure. The creative findings follow, each with
 * its evidence.
 */
export function SignalSurface({
  projectId,
  videoId,
  onSelectVideo,
  onClose,
}: {
  projectId: string;
  videoId: string;
  onSelectVideo: (videoId: string) => void;
  onClose: () => void;
}) {
  const [checkpointDays, setCheckpointDays] = useState(DEFAULT_CHECKPOINT);

  const query = useQuery({
    queryKey: ['signal-surface', projectId, videoId, checkpointDays],
    queryFn: () =>
      getSignalSurfaceAction({ projectId, videoId, checkpointDays }),
  });

  return (
    <section
      id="signal-surface"
      aria-labelledby="signal-surface-title"
      className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm"
      data-test="signal-surface"
      data-video-id={videoId}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 id="signal-surface-title" className="text-lg font-semibold">
            Signals
            {query.data?.status === 'ok' && (
              <>
                {': '}
                <span data-test="signal-surface-title">
                  {query.data.videos[videoId]?.title ?? 'Untitled video'}
                </span>
              </>
            )}
          </h3>
          {query.data?.status === 'ok' && (
            <p className="text-sm text-muted-foreground">
              Published {publishedDay(query.data.publishedAt)} ·{' '}
              {query.data.formatFamily.replaceAll('_', ' ')} · compared at{' '}
              {query.data.checkpointDays} days with this channel’s own earlier
              videos.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {query.data?.status === 'ok' && (
            <CheckpointPicker
              checkpoints={query.data.checkpoints}
              value={checkpointDays}
              onChange={setCheckpointDays}
            />
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Close signals"
            onClick={onClose}
            data-test="signal-surface-close"
          >
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <SurfaceBody
        result={query.data}
        isLoading={query.isLoading}
        isError={query.isError}
        onSelectVideo={onSelectVideo}
      />
    </section>
  );
}

function CheckpointPicker({
  checkpoints,
  value,
  onChange,
}: {
  checkpoints: readonly number[];
  value: number;
  onChange: (days: number) => void;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label="Checkpoint">
      {checkpoints.map((days) => (
        <Button
          key={days}
          type="button"
          size="sm"
          variant={days === value ? 'default' : 'outline'}
          aria-pressed={days === value}
          onClick={() => onChange(days)}
          data-test="signal-checkpoint"
          data-days={days}
        >
          {days}d
        </Button>
      ))}
    </div>
  );
}

function SurfaceBody({
  result,
  isLoading,
  isError,
  onSelectVideo,
}: {
  result: SignalSurfaceResult | undefined;
  isLoading: boolean;
  isError: boolean;
  onSelectVideo: (videoId: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }

  if (isError || !result) {
    return (
      <p className="text-sm text-destructive" data-test="signal-surface-error">
        This video’s signals could not be loaded — a fetch failure, not an
        absence of data.
      </p>
    );
  }

  if (result.status === 'analytics_off') {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-test="signal-surface-off"
      >
        Signals are not available: analytics collection is switched off here, so
        nothing is measured.
      </p>
    );
  }

  if (result.status === 'unavailable') {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-test="signal-surface-unavailable"
        data-reason={result.reason}
      >
        {UNAVAILABLE[result.reason]}
      </p>
    );
  }

  return (
    <>
      <StageStrip stages={result.stages} diagnosis={result.diagnosis} />

      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-medium">Each stage</h4>
        <ol className="flex flex-col" data-test="stage-details">
          {result.stages.map((surface) => (
            <StageDetail
              key={surface.stage}
              surface={surface}
              denominator={result.denominators[surface.stage]}
              videos={result.videos}
              onSelectVideo={onSelectVideo}
            />
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h4 className="text-sm font-medium">
            What separates this channel’s stronger videos
          </h4>
          <p className="text-xs text-muted-foreground">
            Mechanisms found on stronger videos and not on comparable weaker
            ones, per stage. Observed and associated claims describe this
            channel’s videos; only a concluded test makes one causal.
          </p>
        </div>
        <GenomeFindings
          genome={result.genome}
          subjectTags={result.subjectTags}
          videos={result.videos}
          onSelectVideo={onSelectVideo}
        />
      </div>
    </>
  );
}

const UNAVAILABLE: Record<
  Extract<SignalSurfaceResult, { status: 'unavailable' }>['reason'],
  string
> = {
  video_not_found:
    'This video has no analytics yet: nothing has been collected for it.',
  unsupported_platform: 'Signals are not read for this video’s platform.',
  unmapped_format:
    'This video’s format is not one the signal model covers, so its stages have no signals.',
};
