/**
 * Facebook video insights provider (FILM-1720).
 */

export type {
  FacebookInsightsInput,
  FacebookInsightsResult,
  FacebookRetentionGraph,
  FacebookVideoTotals,
} from './types';

export {
  createFacebookInsightsProvider,
  FacebookInsightsProvider,
  FacebookInsightsScopeError,
} from './facebook-insights';
