import { mediaRoute } from '../media';
import type { FailureShape, SocialOrigin, SocialRoute } from '../server';
import { youtubeAnalyticsRoutes } from './google/analytics';
import { youtubeDataRoutes } from './google/data';
import { googleFailure } from './google/errors';
import { googleOAuthRoutes } from './google/oauth';
import { youtubeReportingRoutes } from './google/reporting';

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
  meta: { routes: [mediaRoute] },
  tiktok: { routes: [mediaRoute] },
  x: { routes: [mediaRoute] },
  linkedin: { routes: [mediaRoute] },
};
