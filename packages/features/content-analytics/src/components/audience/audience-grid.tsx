'use client';

import { Users } from 'lucide-react';

import { Skeleton } from '@kit/ui/skeleton';

import type { AudienceData, ExtendedAudienceData } from '../../types';
import { AgeDistributionCard } from './age-distribution-card';
import { DeviceTypeCard } from './device-type-card';
import { GenderSplitCard } from './gender-split-card';
import { GeographyCard } from './geography-card';
import { InterestsCard } from './interests-card';
import { PeakActivityCard } from './peak-activity-card';

interface AudienceGridProps {
  /** Audience data */
  data?: AudienceData & ExtendedAudienceData;
  /** Loading state */
  isLoading?: boolean;
}

// Default mock data for extended fields
const DEFAULT_DEVICE_TYPES = { mobile: 78, desktop: 18, tablet: 4 };
const DEFAULT_INTERESTS = [
  'Sci-Fi Movies',
  'Gaming',
  'Animation',
  'Technology',
  'Digital Art',
  'Storytelling',
  'Visual Effects',
];
const DEFAULT_PEAK_ACTIVITY = [
  [0.2, 0.3, 0.4, 0.6, 0.8, 0.9, 0.7],
  [0.3, 0.4, 0.6, 0.8, 1.0, 1.0, 0.8],
  [0.2, 0.3, 0.4, 0.5, 0.7, 0.9, 0.6],
  [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.5],
];
const DEFAULT_AGE_GROUPS = {
  '13-17': 8.5,
  '18-24': 32.5,
  '25-34': 28.0,
  '35-44': 16.5,
};
const DEFAULT_GENDERS = { male: 58, female: 38.5 };
const DEFAULT_GEOGRAPHY = {
  'United States': 42,
  'United Kingdom': 12.5,
  Canada: 8,
  Australia: 6.5,
  Germany: 5.5,
  France: 4.5,
  Brazil: 4,
};

export function AudienceGrid({ data, isLoading = false }: AudienceGridProps) {
  if (isLoading) {
    return <AudienceGridSkeleton />;
  }

  // Check if we have any real data
  const hasData =
    data &&
    ((data.demographics?.ageGroups &&
      Object.keys(data.demographics.ageGroups).length > 0) ||
      (data.demographics?.genders &&
        Object.keys(data.demographics.genders).length > 0) ||
      (data.geography && Object.keys(data.geography).length > 0));

  if (!hasData && !data?.deviceType && !data?.interests) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Users className="mb-4 h-12 w-12 text-gray-400" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          No Audience Data Available
        </h3>
        <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">
          Audience demographics will appear here once your content gets more
          views and the platforms provide demographic data.
        </p>
      </div>
    );
  }

  // Use real data or fall back to defaults for display
  const ageGroups = data?.demographics?.ageGroups || DEFAULT_AGE_GROUPS;
  const genders = data?.demographics?.genders || DEFAULT_GENDERS;
  const geography = data?.geography || DEFAULT_GEOGRAPHY;
  const deviceTypes = data?.deviceType || DEFAULT_DEVICE_TYPES;
  const peakActivity = data?.peakActivity || DEFAULT_PEAK_ACTIVITY;
  const interests = data?.interests || DEFAULT_INTERESTS;
  const contentAffinity = data?.contentAffinity;

  return (
    <div
      className="grid gap-6 pb-10"
      style={{
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      }}
    >
      <AgeDistributionCard ageGroups={ageGroups} />
      <GenderSplitCard genders={genders} />
      <GeographyCard geography={geography} />
      <DeviceTypeCard deviceTypes={deviceTypes} />
      <PeakActivityCard activityData={peakActivity} />
      <InterestsCard
        interests={interests}
        affinity={
          contentAffinity
            ? {
                label: contentAffinity.label,
                description: `High affinity (+${contentAffinity.percentage}%)`,
              }
            : undefined
        }
      />
    </div>
  );
}

function AudienceGridSkeleton() {
  return (
    <div
      className="grid gap-6"
      style={{
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      }}
    >
      {/* Age Distribution */}
      <Skeleton className="h-80 rounded-2xl" />
      {/* Gender Split */}
      <Skeleton className="h-80 rounded-2xl" />
      {/* Geography (row-span-2) */}
      <Skeleton className="row-span-2 h-full min-h-[400px] rounded-2xl" />
      {/* Device Type */}
      <Skeleton className="h-80 rounded-2xl" />
      {/* Peak Activity */}
      <Skeleton className="h-80 rounded-2xl" />
      {/* Interests */}
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  );
}
