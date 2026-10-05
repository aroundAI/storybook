'use client';

import { Share2 } from 'lucide-react';

import type { Measured } from '../../lib/measured';
import { AnalyticsCard } from './analytics-card';
import { countClaim } from './card-claim';

interface SharesCardProps {
  /** Total shares: absent when they could not be read, null when not measured. */
  shares: Measured<number | null>;
}

/**
 * Shares, and only shares. This card drew a donut of "Direct" against
 * "Copy Link" that was 83/17 for every account — a default typed in from
 * the prototype, with nothing upstream that could have overridden it. No
 * platform read we ingest says how a share happened, so the card says so
 * instead of drawing one (KB-16).
 */
export function SharesCard({ shares }: SharesCardProps) {
  return (
    <AnalyticsCard
      title="Shares"
      icon={Share2}
      metricFamily="engagement"
      claim={countClaim(
        shares,
        'Times content was shared or reposted in the selected period.',
      )}
      details={{
        caveats: [
          <span key="how" data-test="overview-shares-not-collected">
            We don&rsquo;t collect how content was shared, only how often.
          </span>,
        ],
      }}
      data-test="overview-shares"
    />
  );
}
