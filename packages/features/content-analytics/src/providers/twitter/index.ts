/**
 * X analytics provider (FILM-1727): the pay-per-use posts lookup.
 */

export type {
  XAnalyticsResult,
  XMediaNonPublicMetrics,
  XPlaybackQuartiles,
  XPostPublicMetrics,
} from './types';

export {
  createXAnalyticsProvider,
  XAnalyticsProvider,
  XAnalyticsScopeError,
  XPostNotFoundError,
  XRateLimitError,
} from './x-analytics';
