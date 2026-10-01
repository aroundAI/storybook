import { mediaRoute } from '../media';
import type { FailureShape, SocialOrigin, SocialRoute } from '../server';
import { youtubeAnalyticsRoutes } from './google/analytics';
import { youtubeDataRoutes } from './google/data';
import { googleFailure } from './google/errors';
import { googleOAuthRoutes } from './google/oauth';
import { youtubeReportingRoutes } from './google/reporting';
import { linkedInDataRoutes } from './linkedin/data';
import { linkedInFailure } from './linkedin/errors';
import { linkedInOAuthRoutes } from './linkedin/oauth';
import { metaFailure } from './meta/errors';
import { metaInsightsRoutes } from './meta/insights';
import { metaOAuthRoutes } from './meta/oauth';
import { metaPublishingRoutes } from './meta/publishing';
import { metaVersionRoute } from './meta/version';
import { tiktokDataRoutes } from './tiktok/data';
import { tiktokFailure } from './tiktok/errors';
import { tiktokOAuthRoutes } from './tiktok/oauth';
import { xDataRoutes } from './x/data';
import { xFailure } from './x/errors';
import { xOAuthRoutes } from './x/oauth';

/**
 * What each social origin serves. A platform's PR adds its routes here; an
 * origin with none answers every path with a recorded 404.
 */
export const SOCIAL_ROUTES: Record<
  SocialOrigin,
  { routes: readonly SocialRoute[]; failure?: FailureShape }
> = {
  google: {
    routes: [
      mediaRoute,
      ...googleOAuthRoutes,
      ...youtubeDataRoutes,
      ...youtubeAnalyticsRoutes,
      ...youtubeReportingRoutes,
    ],
    failure: googleFailure,
  },
  meta: {
    routes: [
      metaVersionRoute,
      mediaRoute,
      ...metaOAuthRoutes,
      ...metaPublishingRoutes,
      ...metaInsightsRoutes,
    ],
    failure: metaFailure,
  },
  tiktok: {
    routes: [mediaRoute, ...tiktokOAuthRoutes, ...tiktokDataRoutes],
    failure: tiktokFailure,
  },
  x: {
    routes: [mediaRoute, ...xOAuthRoutes, ...xDataRoutes],
    failure: xFailure,
  },
  linkedin: {
    routes: [mediaRoute, ...linkedInOAuthRoutes, ...linkedInDataRoutes],
    failure: linkedInFailure,
  },
};
