/**
 * Instagram Insights Provider
 *
 * Exports for fetching analytics data from Instagram Graph API.
 */

// Types
export type {
  InstagramAccountInsights,
  InstagramAudienceData,
  InstagramInsightsInput,
  InstagramInsightsPeriod,
  InstagramInsightsResult,
  InstagramMediaProductType,
  InstagramMediaType,
  InstagramMetric,
  InstagramTotals,
} from './types';

// Provider class, factory, and errors
export {
  createInstagramInsightsProvider,
  InstagramInsightsProvider,
  InstagramInsightsScopeError,
} from './instagram-insights';
