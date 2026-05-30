'use client';

/**
 * OverviewContent Component
 *
 * Redesigned based on overview/code.html prototype.
 * All data is dynamic, no hardcoded values.
 */
import { HealthDonut } from './health-donut';
import { HeroBanner } from './hero-banner';
import { JumpBackInSection } from './jump-back-in-section';
import type {
  Episode,
  OverviewAnalytics,
  ProductionStatus,
  ProjectMetadata,
} from './overview-constants';
import { DEFAULT_BACKDROP } from './overview-constants';
import { PerformanceInsightsSection } from './performance-insights-section';
import { StatsCards } from './stats-cards';
import { ZeroState } from './zero-state';

interface OverviewContentProps {
  project: {
    id: string;
    name: string;
    description?: string | null;
  };
  metadata: ProjectMetadata;
  episodeCount: number;
  characterCount: number;
  locationCount: number;
  recentEpisodes: Episode[];
  productionStatus: ProductionStatus;
  analytics?: OverviewAnalytics | null;
  baseUrl: string;
}

export function OverviewContent({
  project,
  metadata,
  episodeCount,
  characterCount,
  locationCount,
  recentEpisodes,
  productionStatus,
  analytics,
  baseUrl,
}: OverviewContentProps) {
  const hasEpisodes = episodeCount > 0;
  const backdrop = metadata.coverImageUrl || DEFAULT_BACKDROP;

  // Calculate production percentages
  const scriptPercent =
    productionStatus.totalEpisodes > 0
      ? Math.round(
          (productionStatus.scriptsComplete / productionStatus.totalEpisodes) *
            100,
        )
      : 0;
  const storyboardPercent =
    productionStatus.totalEpisodes > 0
      ? Math.round(
          (productionStatus.storyboardsComplete /
            productionStatus.totalEpisodes) *
            100,
        )
      : 0;
  const visualPercent =
    productionStatus.totalEpisodes > 0
      ? Math.round(
          (productionStatus.visualsComplete / productionStatus.totalEpisodes) *
            100,
        )
      : 0;
  const overallPercent =
    productionStatus.totalEpisodes > 0
      ? Math.round(
          ((productionStatus.scriptsComplete +
            productionStatus.storyboardsComplete +
            productionStatus.visualsComplete) /
            (productionStatus.totalEpisodes * 3)) *
            100,
        )
      : 0;

  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <HeroBanner
        projectName={project.name}
        projectDescription={project.description}
        backdropUrl={backdrop}
        targetAudience={metadata.targetAudience}
        settingsUrl={`${baseUrl}/settings`}
      />

      {/* Stats Cards */}
      <StatsCards
        episodeCount={episodeCount}
        characterCount={characterCount}
        locationCount={locationCount}
        baseUrl={baseUrl}
      />

      {/* Conditional: Zero State or Active State */}
      {!hasEpisodes ? (
        <ZeroState />
      ) : (
        <>
          {/* Performance Insights */}
          <PerformanceInsightsSection analytics={analytics} />

          {/* Jump Back In + Health Grid */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <JumpBackInSection
              recentEpisodes={recentEpisodes}
              baseUrl={baseUrl}
            />

            <HealthDonut
              scriptPercent={scriptPercent}
              storyboardPercent={storyboardPercent}
              visualPercent={visualPercent}
              overallPercent={overallPercent}
            />
          </div>
        </>
      )}
    </div>
  );
}
