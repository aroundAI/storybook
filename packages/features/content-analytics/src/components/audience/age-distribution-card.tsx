'use client';

import { Users } from 'lucide-react';

import { AudienceCard } from './audience-card';

interface AgeGroup {
  label: string;
  percentage: number;
}

interface AgeDistributionCardProps {
  /** Age group data */
  ageGroups: Record<string, number> | AgeGroup[];
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
  // Normalize input data
  const normalizedData: AgeGroup[] = Array.isArray(ageGroups)
    ? ageGroups
    : Object.entries(ageGroups).map(([key, percentage]) => ({
        label: formatAgeLabel(key),
        percentage,
      }));

  // Find the highest percentage to highlight
  const maxPercentage = Math.max(...normalizedData.map((g) => g.percentage));

  return (
    <AudienceCard
      title="Age Distribution"
      icon={Users}
      footerInsight="Primary audience is Gen Z and young adults, suggesting high engagement with trend-based content."
    >
      <div className="space-y-4">
        {normalizedData.map((group, index) => {
          const isHighest = group.percentage === maxPercentage;
          return (
            <div key={index}>
              <div className="mb-1.5 flex justify-between text-xs">
                <span className="font-medium text-gray-900 dark:text-white">
                  {group.label}
                </span>
                <span
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
