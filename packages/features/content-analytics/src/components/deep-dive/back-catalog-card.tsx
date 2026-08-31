'use client';

import { Skeleton } from '@kit/ui/skeleton';

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
  /** Age in days that separates back catalog from new content */
  ageDays?: number;
  /** Loading state */
  isLoading?: boolean;
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
  ageDays = 90,
  isLoading = false,
}: BackCatalogCardProps) {
  if (isLoading) {
    return <BackCatalogCardSkeleton />;
  }

  if (buckets.length === 0) {
    return (
      <p className={'text-muted-foreground text-sm'}>
        Not enough history yet to separate back catalog from new uploads.
      </p>
    );
  }

  const latest = buckets[buckets.length - 1]!;
  const first = buckets[0]!;
  const trend = latest.share - first.share;

  return (
    <div className={'flex flex-col gap-4'}>
      <div className={'flex items-baseline gap-2'}>
        <span className={'text-2xl font-semibold'}>
          {Math.round(latest.share * 100)}%
        </span>
        <span className={'text-muted-foreground text-sm'}>
          from videos over {ageDays} days old
        </span>
      </div>

      <div className={'flex items-end gap-1'} style={{ height: 72 }}>
        {buckets.map((bucket) => (
          <div
            key={bucket.bucket}
            className={'bg-muted flex flex-1 flex-col justify-end rounded-sm'}
            style={{ height: '100%' }}
            title={`${bucket.bucket}: ${Math.round(bucket.share * 100)}% of ${bucket.totalViews.toLocaleString()} views`}
          >
            <div
              className={'bg-primary/70 w-full rounded-sm'}
              style={{ height: `${Math.max(2, bucket.share * 100)}%` }}
            />
          </div>
        ))}
      </div>

      <p className={'text-muted-foreground text-xs'}>
        {buckets.length < 3
          ? 'Needs a few more months before the trend means anything.'
          : trend > 0.05
            ? 'Climbing — the catalog is compounding.'
            : trend < -0.05
              ? 'Falling — recent uploads carry more of the load than the catalog does.'
              : 'Flat — the catalog is not compounding yet; the evergreen assumption may need revisiting.'}
      </p>
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
