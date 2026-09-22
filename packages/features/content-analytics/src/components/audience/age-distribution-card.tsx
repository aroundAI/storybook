'use client';

import { Users } from 'lucide-react';

import { AudienceCard, AudienceCardEmpty } from './audience-card';

interface AgeGroup {
  /** The platform's own bucket, e.g. `age18-24`. */
  key: string;
  label: string;
  percentage: number;
}

interface AgeDistributionCardProps {
  /** Percentage of viewers per age bucket. Absent when none was reported. */
  ageGroups?: Record<string, number>;
}

function formatAgeLabel(key: string): string {
  // Handle various formats: "age18-24", "18-24", "AGE18_24"
  const match = key.match(/(\d+)[_-]?(\d+)?/);
  if (match) {
    const [, start, end] = match;
    if (end) {
      return `${start}-${end} years`;
    }
    return `${start}+ years`;
  }
  return key;
}

export function AgeDistributionCard({ ageGroups }: AgeDistributionCardProps) {
  const normalizedData: AgeGroup[] = Object.entries(ageGroups ?? {})
    .map(([key, percentage]) => ({
      key,
      label: formatAgeLabel(key),
      percentage,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  if (normalizedData.length === 0) {
    return (
      <AudienceCard
        title="Age Distribution"
        icon={Users}
        data-test="audience-card-age"
      >
        <AudienceCardEmpty>
          No platform has reported viewer ages for this project yet.
        </AudienceCardEmpty>
      </AudienceCard>
    );
  }

  // Find the highest percentage to highlight
  const maxPercentage = Math.max(...normalizedData.map((g) => g.percentage));

  return (
    <AudienceCard
      title="Age Distribution"
      icon={Users}
      data-test="audience-card-age"
    >
      <div className="space-y-4">
        {normalizedData.map((group) => {
          const isHighest = group.percentage === maxPercentage;
          return (
            <div key={group.key} data-test={`age-row-${group.key}`}>
              <div className="mb-1.5 flex justify-between text-xs">
                <span className="font-medium text-gray-900 dark:text-white">
                  {group.label}
                </span>
                <span
                  data-test="age-share"
                  className={
                    isHighest
                      ? 'font-bold text-blue-500'
                      : 'text-gray-500 dark:text-gray-400'
                  }
                >
                  {group.percentage.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-700">
                <div
                  className={`h-2 rounded-full ${
                    isHighest ? 'bg-blue-500' : 'bg-gray-400 dark:bg-gray-500'
                  }`}
                  style={{ width: `${group.percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </AudienceCard>
  );
}
