'use client';

import { Clock, Sparkles, Users } from 'lucide-react';

import { Skeleton } from '@kit/ui/skeleton';

import type { ProjectAudienceData } from '../../server/aggregation-queries';
import { AgeDistributionCard } from './age-distribution-card';
import { DeviceTypeCard } from './device-type-card';
import { GenderSplitCard } from './gender-split-card';
import { GeographyCard } from './geography-card';
import { NotCollectedCard } from './not-collected-card';

interface AudienceGridProps {
  /**
   * What `getProjectAudienceData` returned — the server's own type, so a
   * card cannot be handed a field the read does not produce. This was
   * `AudienceData & ExtendedAudienceData`, which declared `deviceType`,
   * `peakActivity` and `interests` that nothing ever populated, and that is
   * how three `||` fallbacks to constants became the only code path.
   */
  data?: ProjectAudienceData;
  /** Loading state */
  isLoading?: boolean;
}

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

  if (!hasData && !data?.deviceType) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 text-center"
        data-test="audience-empty"
      >
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

  return (
    <div
      className="grid gap-6 pb-10"
      data-test="audience-grid"
      style={{
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      }}
    >
      <AgeDistributionCard ageGroups={data?.demographics?.ageGroups} />
      <GenderSplitCard genders={data?.demographics?.genders} />
      <GeographyCard geography={data?.geography} />
      <DeviceTypeCard deviceType={data?.deviceType} />
      <NotCollectedCard
        title="Peak Activity"
        icon={Clock}
        data-test="audience-card-peak-activity"
        reason="Nothing we ingest from a connected channel says when its viewers are online, so there is no figure to show."
      />
      <NotCollectedCard
        title="Audience Interests"
        icon={Sparkles}
        data-test="audience-card-interests"
        reason="Nothing we ingest from a connected channel says what else its viewers are interested in, so there is no figure to show."
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
