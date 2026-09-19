'use client';

import { Skeleton } from '@kit/ui/skeleton';

/** One variant's 3-second retention, as cached on hook_variants. */
export interface VariantRetentionEntry {
  id: string;
  label: string;
  hookType: string;
  retention3s: number | null;
  retentionFull: number | null;
  isWinner: boolean;
}

interface RetentionComparisonChartProps {
  /** Variants to compare */
  variants: VariantRetentionEntry[];
  /** 3-second retention a variant must clear to win */
  viralThreshold: number;
  /** Loading state */
  isLoading?: boolean;
}

const HOOK_TYPE_LABELS: Record<string, string> = {
  negative_bias: 'Negative bias',
  visual_asmr: 'Visual / ASMR',
  question: 'Question',
  pattern_interrupt: 'Pattern interrupt',
  authority: 'Authority',
  other: 'Other',
};

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

/**
 * Compares variants on 3-second retention against the test's threshold.
 * The threshold is drawn as a line rather than ranking variants alone,
 * because the question is whether a hook is good enough, not merely
 * better than its siblings.
 */
export function RetentionComparisonChart({
  variants,
  viralThreshold,
  isLoading = false,
}: RetentionComparisonChartProps) {
  if (isLoading) {
    return <RetentionComparisonChartSkeleton />;
  }

  if (variants.length === 0) {
    return (
      <p className={'text-sm text-muted-foreground'}>
        Add variants and publish them to compare retention.
      </p>
    );
  }

  const measured = variants.filter((v) => v.retention3s !== null);

  return (
    <div className={'flex flex-col gap-4'}>
      <div className={'relative flex flex-col gap-3'}>
        {variants.map((variant) => {
          const value = variant.retention3s;
          const clears = value !== null && value >= viralThreshold;

          return (
            <div key={variant.id} className={'flex flex-col gap-1'}>
              <div className={'flex items-baseline justify-between gap-2'}>
                <span className={'truncate text-sm font-medium'}>
                  {variant.label}
                  <span className={'ml-2 font-normal text-muted-foreground'}>
                    {HOOK_TYPE_LABELS[variant.hookType] ?? variant.hookType}
                  </span>
                </span>
                <span className={'shrink-0 text-xs text-muted-foreground'}>
                  {pct(value)} at 3s · {pct(variant.retentionFull)} full
                  {variant.isWinner ? ' · winner' : ''}
                </span>
              </div>

              <div
                className={
                  'relative h-2.5 w-full overflow-hidden rounded-full bg-muted'
                }
              >
                <div
                  className={
                    clears
                      ? 'h-full bg-primary'
                      : 'h-full bg-muted-foreground/50'
                  }
                  style={{ width: `${Math.min(100, (value ?? 0) * 100)}%` }}
                />
                <div
                  className={'absolute top-0 h-full w-0.5 bg-foreground/60'}
                  style={{ left: `${viralThreshold * 100}%` }}
                  title={`Viral threshold ${pct(viralThreshold)}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className={'text-xs text-muted-foreground'}>
        Threshold {pct(viralThreshold)} at 3 seconds.{' '}
        {measured.length === 0
          ? 'No retention data yet — variants need published videos and a completed analytics sync.'
          : `${measured.length} of ${variants.length} variants measured.`}
      </p>
    </div>
  );
}

export function RetentionComparisonChartSkeleton() {
  return (
    <div className={'flex flex-col gap-3'}>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className={'flex flex-col gap-1'}>
          <Skeleton className={'h-4 w-1/2'} />
          <Skeleton className={'h-2.5 w-full rounded-full'} />
        </div>
      ))}
    </div>
  );
}
