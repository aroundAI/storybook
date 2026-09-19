'use client';

import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { TagMediansCard } from '@kit/content-analytics/components';
import { isUnavailable } from '@kit/content-analytics/lib/query-state';
import { getSegmentPerformanceAction } from '@kit/content-analytics/server/segment-actions';
import { getMedianByTagAction } from '@kit/content-analytics/server/taxonomy-actions';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';

type TagDimension = Parameters<typeof getMedianByTagAction>[0]['dimension'];

type Dimension = TagDimension | 'language';

/** Both paths measure at the same age, so the switcher compares like with like. */
const CHECKPOINT_DAYS = 30;

const DIMENSIONS: Array<{ value: Dimension; label: string }> = [
  { value: 'topic', label: 'Topic' },
  { value: 'format', label: 'Format' },
  { value: 'thumbnail_style', label: 'Thumbnail style' },
  { value: 'hook_type', label: 'Hook type' },
  { value: 'language', label: 'Language' },
];

interface TagMediansPanelProps {
  accountId: string;
  /**
   * The account's minimum sample, resolved on the server. The tag action
   * applies it itself; Language goes through the segment action, whose own
   * default would otherwise let the switcher use two different cut-offs.
   */
  minVideos: number;
}

/**
 * Median performance by taxonomy dimension, plus Language.
 *
 * Language is not a taxonomy dimension: it is a `video_dim` column, so it is
 * read through the segment action rather than the tag action (FILM-1606).
 * The switcher puts them side by side without pretending they are the same
 * kind of thing.
 */
export function TagMediansPanel({
  accountId,
  minVideos,
}: TagMediansPanelProps) {
  const [dimension, setDimension] = useState<Dimension>('topic');

  const query = useQuery({
    queryKey: ['tag-medians', accountId, dimension, minVideos],
    queryFn: async () => {
      if (dimension === 'language') {
        const result = await getSegmentPerformanceAction({
          accountId,
          kind: 'language',
          minVideos,
          checkpointDays: CHECKPOINT_DAYS,
          includeRevenue: false,
        });

        return {
          rows: result.rows,
          insufficientSample: false,
          taggedCount: 0,
          required: minVideos,
          attributedRevenueOnly: result.attributedRevenueOnly,
        };
      }

      const result = await getMedianByTagAction({
        accountId,
        dimension,
        checkpointDays: CHECKPOINT_DAYS,
      });

      return {
        rows: result.rows,
        insufficientSample: result.insufficientSample,
        taggedCount: 'taggedCount' in result ? result.taggedCount : 0,
        required: 'required' in result ? result.required : minVideos,
        attributedRevenueOnly: false,
      };
    },
  });

  return (
    <section
      className={'flex flex-col gap-4 rounded-2xl border p-6'}
      data-test={'tag-medians-card'}
    >
      <div className={'flex items-center justify-between gap-4'}>
        <div className={'flex flex-col gap-1'}>
          <h3 className={'text-base font-medium'}>Median performance</h3>
          <p className={'text-sm text-muted-foreground'}>
            Median views per video at {CHECKPOINT_DAYS} days, by segment.
          </p>
        </div>

        <Select
          value={dimension}
          onValueChange={(next) => setDimension(next as Dimension)}
        >
          <SelectTrigger
            className={'w-48'}
            aria-label={'Dimension'}
            data-test={'tag-medians-dimension-trigger'}
          >
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            {DIMENSIONS.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                data-test={`tag-medians-dimension-${option.value}`}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isUnavailable(query) ? (
        <p className={'text-sm text-destructive'}>
          Medians could not be loaded.
        </p>
      ) : (
        <TagMediansCard
          rows={query.data?.rows ?? []}
          insufficientSample={query.data?.insufficientSample}
          taggedCount={query.data?.taggedCount}
          required={query.data?.required}
          attributedRevenueOnly={query.data?.attributedRevenueOnly}
          segmentNoun={dimension === 'language' ? 'language' : 'tag'}
          isLoading={query.isLoading}
        />
      )}
    </section>
  );
}
