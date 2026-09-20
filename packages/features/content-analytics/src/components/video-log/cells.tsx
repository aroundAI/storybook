'use client';

import { Badge } from '@kit/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';

import {
  type CheckpointState,
  type QualityState,
} from '../../lib/video-log-cells';

/**
 * A value that is not a number, with the reason one reachable by mouse,
 * keyboard and screen reader. The trigger is a real button: a hover-only
 * tooltip hides the explanation from anyone not using a mouse, and the
 * explanation is the point of the cell.
 */
export function ExplainedValue({
  text,
  explanation,
  className,
  testId,
}: {
  text: string;
  explanation: string;
  className?: string;
  testId: string;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type={'button'}
            className={`cursor-help underline decoration-dotted underline-offset-2 ${className ?? ''}`}
            aria-label={`${text}: ${explanation}`}
            data-test={testId}
          >
            {text}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p className={'max-w-xs text-sm'}>{explanation}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const exact = new Intl.NumberFormat('en-US');

/**
 * One views-at-age cell. Each state differs in its text, not only its
 * colour, so none can be mistaken for another — and none but a figure is
 * ever a number.
 */
export function CheckpointCell({
  state,
  days,
}: {
  state: CheckpointState;
  days: number;
}) {
  switch (state.kind) {
    case 'figure':
      return (
        <span className={'tabular-nums'} data-test={'checkpoint-figure'}>
          {exact.format(state.value)}
        </span>
      );

    case 'immature':
      return (
        <ExplainedValue
          text={`in ${state.daysToGo} ${state.daysToGo === 1 ? 'day' : 'days'}`}
          explanation={
            state.ageDays === null
              ? `Views in a video's first ${days} days are known once it is ${days} days old.`
              : `This video is ${state.ageDays} days old. Views in its first ${days} days are known in ${state.daysToGo} ${state.daysToGo === 1 ? 'day' : 'days'}.`
          }
          className={'text-muted-foreground italic'}
          testId={'checkpoint-immature'}
        />
      );

    case 'predates':
      return (
        <ExplainedValue
          text={'n/a'}
          explanation={`Analytics for this channel began ${state.lagDays} days after this video was published, after its first ${days} days had ended. This figure can't be recovered.`}
          className={'rounded bg-muted px-1 text-muted-foreground'}
          testId={'checkpoint-predates'}
        />
      );

    case 'no-data':
      return <NoData testId={'checkpoint-no-data'} />;
  }
}

function NoData({ testId }: { testId: string }) {
  return (
    <ExplainedValue
      text={'—'}
      explanation={'No analytics have been received for this video yet.'}
      className={'text-muted-foreground'}
      testId={testId}
    />
  );
}

const NONE_EXPLANATIONS: Record<
  Exclude<Extract<QualityState, { kind: 'none' }>['reason'], 'no-data'>,
  string
> = {
  'no-impressions': 'No impressions recorded.',
  'no-views': 'No views recorded.',
  'not-reported': 'This platform did not report it for this video.',
};

/** A lifetime cell: a formatted value, or why there is none. */
export function QualityCell({
  state,
  format,
  testId,
}: {
  state: QualityState;
  format: (value: number) => string;
  testId: string;
}) {
  if (state.kind === 'value') {
    return (
      <span className={'tabular-nums'} data-test={`${testId}-value`}>
        {format(state.value)}
      </span>
    );
  }

  if (state.reason === 'no-data') {
    return <NoData testId={`${testId}-no-data`} />;
  }

  return (
    <ExplainedValue
      text={'—'}
      explanation={NONE_EXPLANATIONS[state.reason]}
      className={'text-muted-foreground'}
      testId={`${testId}-none`}
    />
  );
}

export const formatViews = (value: number) => exact.format(value);
export const formatRatio = (value: number) => `${(value * 100).toFixed(1)}%`;
export const formatPercentValue = (value: number) => `${value.toFixed(1)}%`;
export function formatSeconds(value: number): string {
  const total = Math.round(value);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Lifetime revenue, one amount per currency (EDD F-2). Different
 * currencies are listed, never added: there are no rates to convert with.
 */
export function RevenueCell({
  revenue,
}: {
  revenue: Array<{ currency: string | null; cents: number }>;
}) {
  if (revenue.length === 0) {
    return (
      <ExplainedValue
        text={'—'}
        explanation={'No revenue recorded for this video.'}
        className={'text-muted-foreground'}
        testId={'revenue-none'}
      />
    );
  }

  return (
    <span className={'whitespace-nowrap tabular-nums'} data-test={'revenue'}>
      {revenue.map(formatAmount).join(' + ')}
    </span>
  );
}

function formatAmount({
  currency,
  cents,
}: {
  currency: string | null;
  cents: number;
}): string {
  if (!currency) return `${(cents / 100).toFixed(2)} (currency not recorded)`;

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(cents / 100);
  } catch {
    // An unrecognised code still shows its amount and its code.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** The row-level flag for a video whose early days were missed. */
export function PartialBadge({ lagDays }: { lagDays: number }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type={'button'}
            aria-label={`Partial: analytics began ${lagDays} days after publication, so the first ${lagDays} days are missing from every figure in this row.`}
            data-test={'video-log-partial'}
          >
            <Badge variant={'outline'} className={'cursor-help'}>
              Partial
            </Badge>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p className={'max-w-xs text-sm'}>
            Analytics began {lagDays} days after publication, so the first{' '}
            {lagDays} days are missing from every figure in this row.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
