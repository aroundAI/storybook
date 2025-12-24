export {
  CompactMetric,
  MetricCard,
  MetricCards,
  MetricCardSkeleton,
} from './metric-cards';

export type { MetricConfig } from './metric-cards';

export { PerformanceChart } from './performance-chart';
export { SparklineChart } from './sparkline-chart';
export { ComparisonChart } from './comparison-chart';

// Analytics Dashboard Components
export { EpisodeAnalytics } from './episode-analytics';
export { SeasonOverview } from './season-overview';
export { ProjectDashboard } from './project-dashboard';

// AI Insights
export { AIInsights } from './ai-insights';

// Export Reports
export { ExportReports } from './export-reports';
export { ScheduledReportsManager } from './scheduled-reports-manager';

// Revenue components (FILM-810)
export { DateRangePicker, type DateRangeValue } from './date-range-picker';
export { ManualRevenueForm } from './manual-revenue-form';
export { RevenueChart, RevenueChartSkeleton } from './revenue-chart';
export {
  RevenueDashboard,
  RevenueDashboardSkeleton,
} from './revenue-dashboard';
export {
  RevenuePlatformBreakdown,
  RevenuePlatformBreakdownSkeleton,
} from './revenue-platform-breakdown';
export {
  RevenueTopContent,
  RevenueTopContentSkeleton,
} from './revenue-top-content';

// Analytics Dashboard (FILM-805)
export {
  AnalyticsDashboard,
  AnalyticsDashboardSkeleton,
} from './analytics-dashboard';
export type { AnalyticsDashboardProps } from './analytics-dashboard';
export { ContentTable, type ContentTableProps } from './content-table';
export {
  PlatformFilter,
  type PlatformFilterProps,
  type Platform,
} from './platform-filter';
export {
  AudienceAnalytics,
  type AudienceAnalyticsProps,
} from './audience-analytics';

// Chart Components (Redesign)
export {
  SparklineArea,
  MiniBarChart,
  HorizontalProgress,
  DonutChart,
  PeakActivityGrid,
  TagCloudWithAffinity,
} from './charts';

// Overview Grid Components (Redesign)
export {
  OverviewGrid,
  AnalyticsCard,
  ViewsCard,
  LikesCard,
  PlatformSplitCard,
  CommentsCard,
  AIInsightCard,
  SharesCard,
  TopContentCard,
  RevenueCard,
  TopRegionsCard,
  GenderCard,
} from './overview';

// Content Grid Components (Redesign)
export { ContentGrid, ContentCard } from './content';

// Audience Grid Components (Redesign)
export {
  AudienceGrid,
  AudienceCard,
  AgeDistributionCard,
  GenderSplitCard,
  GeographyCard,
  DeviceTypeCard,
  PeakActivityCard,
  InterestsCard,
} from './audience';

// Account-level Company Dashboard
export {
  CompanyDashboard,
  CompanyDashboardSkeleton,
} from './company-dashboard';

// Language Analytics Dashboard (Multi-language analytics)
export {
  LanguagePerformanceCard,
  LanguagePerformanceCardSkeleton,
  PlatformLanguageMatrix,
  PlatformLanguageMatrixSkeleton,
  ContentTypeCard,
  ContentTypeCardSkeleton,
} from './language-analytics-cards';

export {
  LanguageAnalyticsDashboard,
  LanguageAnalyticsDashboardSkeleton,
} from './language-analytics-dashboard';

// Shorts & Geography Cards (Phase 3 & 4)
export {
  TopShortsCard,
  TopShortsCardSkeleton,
  LanguageGeographyCard,
  LanguageGeographyCardSkeleton,
} from './shorts-geography-cards';
