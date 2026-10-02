'use client';

import { Skeleton } from '@kit/ui/skeleton';
import { cn } from '@kit/ui/utils';

import {
  VIEW_DEFINITION_BAR_EDGE,
  type ViewDefinitionMark,
  markedBuckets,
} from '../../lib/view-definition-marks';
import type { CardClaim } from '../overview/card-claim';
import { ChartMark, ChartMarks, formatTrueShare } from './chart-marks';

/** One bucket from getBackCatalogAction. */
export interface BackCatalogEntry {
  bucket: string;
  totalViews: number;
  backCatalogViews: number;
  share: number;
}

interface BackCatalogCardProps {
  /** Monthly buckets in chronological order */
  buckets: BackCatalogEntry[];
  /** Loading state */
  isLoading?: boolean;
  /** View-definition changes inside the range, drawn on their bucket (FILM-1722). */
  marks?: readonly ViewDefinitionMark[];
}

/**
 * The newest month's back-catalog share, and which way it has moved since
 * the first month shown.
 */
export function backCatalogClaim(
  buckets: readonly BackCatalogEntry[],
): CardClaim {
  const latest = buckets[buckets.length - 1];
  const first = buckets[0];

  if (!latest || !first) {
    return {
      figure: null,
      noFigure: 'Not enough history yet.',
      sentence: 'Back catalog and new uploads cannot be told apart yet.',
    };
  }

  const trend = latest.share - first.share;

  return {
    figure: `${Math.round(latest.share * 100)}%`,
    sentence:
      buckets.length < 3
        ? 'Needs a few more months before the trend means anything.'
        : trend > 0.05
          ? 'Climbing — the catalog is compounding.'
          : trend < -0.05
            ? 'Falling — recent uploads carry more of the load than the catalog does.'
            : 'Flat — the catalog is not compounding yet; the evergreen assumption may need revisiting.',
  };
}

/**
 * Share of views coming from videos older than the age cutoff.
 *
 * For evergreen content this should climb steadily. If it stays flat as a
 * channel matures, the catalog is not compounding and the evergreen
 * thesis needs revisiting — which is the point of tracking it.
 */
export function BackCatalogCard({
  buckets,
  isLoading = false,
  marks = [],
}: BackCatalogCardProps) {
  if (isLoading) {
    return <BackCatalogCardSkeleton />;
  }

  // The claim above says there is not enough history yet.
  if (buckets.length === 0) {
    return null;
  }

  const marked = markedBuckets(
    buckets.map(({ bucket }) => bucket),
    marks,
  );

  return (
    <div className={'flex flex-col gap-4'}>
      <ChartMarks
        label={'Back catalog share of views by month'}
        className={'flex items-end gap-1'}
        style={{ height: 72 }}
      >
        {buckets.map((bucket, index) => (
          <ChartMark
            key={bucket.bucket}
            col={index}
            data-view-definition={
              marked.has(bucket.bucket) ? 'true' : undefined
            }
            className={cn(
              'flex flex-1 flex-col justify-end rounded-sm bg-muted',
              marked.has(bucket.bucket) && VIEW_DEFINITION_BAR_EDGE,
            )}
            style={{ height: '100%' }}
            detail={`${bucket.bucket}: ${formatTrueShare(bucket.share)} of ${bucket.totalViews.toLocaleString()} views`}
            data-test={'back-catalog-bar'}
            data-share={bucket.share}
          >
            <div
              className={'w-full rounded-sm bg-primary/70'}
              style={{ height: `${Math.max(2, bucket.share * 100)}%` }}
            />
          </ChartMark>
        ))}
      </ChartMarks>
    </div>
  );
}

export function BackCatalogCardSkeleton() {
  return (
    <div className={'flex flex-col gap-4'}>
      <Skeleton className={'h-8 w-40'} />
      <Skeleton className={'h-18 w-full'} />
    </div>
  );
}
