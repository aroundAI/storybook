import type { AudienceDimension } from '@kit/clickhouse/server';

type AudienceDimensionReader =
  | {
      status: 'read';
      /** The file that asks for the dimension, relative to `src/`. */
      readBy: string;
      surface: string;
    }
  | { status: 'unread'; reason: string };

/**
 * Which surface reads each `video_audience` dimension (FILM-1701).
 *
 * `buildAudienceRows` wrote `device`, `os`, `city` and `follower_status` on
 * every sync for as long as the table has existed, and the Audience tab
 * asked for none of them — while rendering a Device Type card from a
 * constant. A `Record` over the closed union, so adding a dimension does not
 * compile until someone says whether anything reads it;
 * `no-literal-fallbacks.test.ts` holds each entry to the code and to the
 * spec's table.
 */
export const AUDIENCE_DIMENSION_READERS: Record<
  AudienceDimension,
  AudienceDimensionReader
> = {
  age_group: {
    status: 'read',
    readBy: 'server/aggregation-queries.ts',
    surface: 'Audience › Age Distribution',
  },
  gender: {
    status: 'read',
    readBy: 'server/aggregation-queries.ts',
    surface: 'Audience › Gender Split, Overview › Gender',
  },
  country: {
    status: 'read',
    readBy: 'server/aggregation-queries.ts',
    surface: 'Audience › Top Geographies, Overview › Top Regions',
  },
  device: {
    status: 'read',
    readBy: 'server/aggregation-queries.ts',
    surface: 'Audience › Device Type',
  },
  follower_status: {
    status: 'read',
    readBy: 'server/deep-dive-service.ts',
    surface: 'Deep Dive › returning-viewer proxy',
  },
  city: {
    status: 'unread',
    reason: 'No card. FILM-1707 decides its surface.',
  },
  os: {
    status: 'unread',
    reason: 'No card. FILM-1707 decides its surface.',
  },
};
