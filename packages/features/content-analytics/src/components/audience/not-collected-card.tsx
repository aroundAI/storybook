'use client';

import { AudienceCard, AudienceCardEmpty } from './audience-card';

interface NotCollectedCardProps {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Why there is nothing here, in a sentence a creator can act on. */
  reason: string;
  'data-test'?: string;
}

/**
 * A card for something we do not measure (FILM-1701).
 *
 * Interests and Peak Activity used to occupy these slots with constants
 * typed into a source file. They are kept as slots, saying so, rather than
 * removed: a gap in the grid is an invitation to refill it, and a zero would
 * be a measurement nobody made.
 */
export function NotCollectedCard({
  title,
  icon,
  reason,
  'data-test': dataTest,
}: NotCollectedCardProps) {
  return (
    <AudienceCard title={title} icon={icon} data-test={dataTest}>
      <AudienceCardEmpty
        heading="We don't collect this"
        data-test="audience-not-collected"
      >
        {reason}
      </AudienceCardEmpty>
    </AudienceCard>
  );
}
