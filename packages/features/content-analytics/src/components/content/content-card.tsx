'use client';

import Image from 'next/image';

import { format } from 'date-fns';

import type { AnalyticsPlatform, RecordedRate } from '@kit/clickhouse';

import { formatNumber, formatPercent } from '../../lib/format';
import { VIEWS_NOT_MEASURED } from '../../lib/views';
import type { Views } from '../../lib/views';
import { AnalyticsCard } from '../overview/analytics-card';
import type { CardClaim } from '../overview/card-claim';
import { RateDenominator } from '../rate-denominator';

interface ContentCardProps {
  publishId?: string;
  /** Content title */
  title: string;
  /** Episode or subtitle */
  subtitle?: string;
  /** Thumbnail URL */
  thumbnailUrl?: string;
  /** The platform the item was published to */
  platform: AnalyticsPlatform;
  /** Published date */
  publishedAt: string;
  /** View count */
  /** Null for a Facebook publish: no single view (KB-153). */
  views: Views;
  /** Like count */
  likes: number;
  /** Comment count */
  comments: number;
  /** Engagement rate percentage, with what it was divided by (FILM-1732) */
  engagementRate: RecordedRate | null;
  /** Click handler */
  onClick?: () => void;
}

/** The card's claim: its views, and when it went out. */
export function contentCardClaim({
  views,
  publishedAt,
  engagementRate,
}: Pick<
  ContentCardProps,
  'views' | 'publishedAt' | 'engagementRate'
>): CardClaim {
  const published = `Published ${format(new Date(publishedAt), 'MMM d, yyyy')}`;

  // No single view on this platform (KB-153): not measured, never 0.
  if (views === null) {
    return {
      figure: null,
      noFigure: `Views ${VIEWS_NOT_MEASURED.toLowerCase()}`,
      sentence: `${published}.`,
    };
  }

  return {
    figure: formatNumber(views),
    sentence:
      engagementRate === null
        ? `Views to date. ${published}.`
        : `Views to date. ${published} · ${formatPercent(engagementRate.value)} engagement.`,
  };
}

/**
 * One published item (FILM-1707: on the one card shell).
 *
 * Its platform is said once, by the provenance chip — "TikTok only ·
 * derived" says which platform and how its figures arrive. The brand-coloured
 * badge that said the same thing beside it is gone: two indications of one
 * fact, one of them in a colour that competes with the data (FILM-1705 §2).
 */
export function ContentCard({
  publishId,
  title,
  subtitle,
  thumbnailUrl,
  platform,
  publishedAt,
  views,
  likes,
  comments,
  engagementRate,
  onClick,
}: ContentCardProps) {
  const card = (
    <AnalyticsCard
      title={title}
      metricFamily={'engagement'}
      platforms={[platform]}
      claim={contentCardClaim({ views, publishedAt, engagementRate })}
      details={null}
      data-test={'content-card'}
    >
      <div className="flex flex-col gap-3">
        {subtitle && (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        )}

        <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
          {thumbnailUrl ? (
            <Image
              src={thumbnailUrl}
              alt={title}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 400px"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-2xl text-muted-foreground">🎬</span>
            </div>
          )}
        </div>

        <dl className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-sm">
          <ContentMetric label="Likes" value={formatNumber(likes)} />
          <ContentMetric label="Comments" value={formatNumber(comments)} />
          <ContentMetric
            label="Engagement"
            value={
              engagementRate === null
                ? VIEWS_NOT_MEASURED
                : formatPercent(engagementRate.value)
            }
            aside={
              engagementRate && (
                <RateDenominator
                  denominator={engagementRate.denominator}
                  figure="engagement rate"
                  subject={title}
                />
              )
            }
          />
        </dl>
      </div>
    </AnalyticsCard>
  );

  if (!onClick) {
    return <div data-publish-id={publishId}>{card}</div>;
  }

  return (
    <div
      data-publish-id={publishId}
      className="cursor-pointer"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onClick();
      }}
      role="button"
      tabIndex={0}
    >
      {card}
    </div>
  );
}

function ContentMetric({
  label,
  value,
  aside,
}: {
  label: string;
  value: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <dt className="mb-0.5 text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 font-medium tabular-nums">
        {value}
        {aside}
      </dd>
    </div>
  );
}
