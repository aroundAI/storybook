/**
 * Facebook video insights provider (FILM-1720).
 */

export type {
  FacebookAudience,
  FacebookInsightsInput,
  FacebookPageViewers,
  FacebookInsightsResult,
  FacebookRetentionGraph,
  FacebookVideoTotals,
} from './types';

export {
  FACEBOOK_PAGE_PERIODS,
  createFacebookInsightsProvider,
  FacebookInsightsProvider,
  FacebookInsightsScopeError,
} from './facebook-insights';
