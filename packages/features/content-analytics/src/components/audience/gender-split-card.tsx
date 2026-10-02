'use client';

import { Users2 } from 'lucide-react';

import { DonutChart } from '../charts/donut-chart';
import { genderClaim } from '../overview/card-claim';
import { AudienceCard, AudienceCardEmpty } from './audience-card';
import { NO_GENDER_CLAIM } from './audience-claims';

interface GenderSplitCardProps {
  /** Percentage of viewers per gender. Absent when none was reported. */
  genders?: Record<string, number>;
}

export function GenderSplitCard({ genders }: GenderSplitCardProps) {
  // Zero for a key with no rows. These fell back to 58 and 38.5, so a
  // project whose rows held one gender was shown the other from a constant.
  // YouTube's third value is `user_specified`; TikTok's is `other`.
  const male = genders?.['male'] || 0;
  const female = genders?.['female'] || 0;
  const other = (genders?.['other'] || 0) + (genders?.['user_specified'] || 0);

  // Nothing to draw is an empty card, not an empty donut.
  if (male + female + other === 0) {
    return (
      <AudienceCard
        title="Gender Split"
        icon={Users2}
        metricFamily="demographics"
        claim={NO_GENDER_CLAIM}
        data-test="audience-card-gender"
      >
        <AudienceCardEmpty>
          No platform has reported viewer gender for this project yet.
        </AudienceCardEmpty>
      </AudienceCard>
    );
  }

  // Determine primary gender for center label
  const primary =
    male >= female
      ? { value: male, label: 'Male' }
      : { value: female, label: 'Female' };

  return (
    <AudienceCard
      title="Gender Split"
      icon={Users2}
      metricFamily="demographics"
      claim={genderClaim({ male, female, other })}
      data-test="audience-card-gender"
    >
      <div className="flex flex-1 flex-col items-center justify-center py-4">
        <DonutChart
          segments={[
            {
              value: male,
              color: 'rgb(59, 130, 246)',
              label: 'Male',
              testId: 'gender-share-male',
            },
            {
              value: female,
              color: 'rgb(236, 72, 153)',
              label: 'Female',
              testId: 'gender-share-female',
            },
            ...(other > 0
              ? [
                  {
                    value: other,
                    color: 'rgb(168, 85, 247)',
                    label: 'Other',
                    testId: 'gender-share-other',
                  },
                ]
              : []),
          ]}
          size={128}
          thickness={12}
          centerLabel={`${primary.value.toFixed(0)}%`}
          centerSublabel={primary.label}
          showLegend={true}
        />
      </div>
    </AudienceCard>
  );
}
