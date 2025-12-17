'use client';

import { Users2 } from 'lucide-react';

import { DonutChart } from '../charts/donut-chart';
import { AudienceCard } from './audience-card';

interface GenderSplitCardProps {
  /** Gender percentages */
  genders: Record<string, number>;
}

export function GenderSplitCard({ genders }: GenderSplitCardProps) {
  const male = genders['male'] || genders['Male'] || 58;
  const female = genders['female'] || genders['Female'] || 38.5;
  const other = genders['other'] || genders['Other'] || 0;

  // Determine primary gender for center label
  const primary =
    male >= female
      ? { value: male, label: 'Male' }
      : { value: female, label: 'Female' };

  return (
    <AudienceCard
      title="Gender Split"
      icon={Users2}
      footerInsight="Male viewership has increased by 4.2% over the last month, correlating with action genre clips."
    >
      <div className="flex flex-1 flex-col items-center justify-center py-4">
        <DonutChart
          segments={[
            { value: male, color: 'rgb(59, 130, 246)', label: 'Male' },
            { value: female, color: 'rgb(236, 72, 153)', label: 'Female' },
            ...(other > 0
              ? [{ value: other, color: 'rgb(168, 85, 247)', label: 'Other' }]
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
