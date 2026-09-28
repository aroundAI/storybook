import type { EnvelopeField, ServedEndpoint } from '../../fields';

/**
 * What the Google origin serves, endpoint by endpoint (criterion 5): the
 * fields the app reads — each documented in the named field-index block —
 * and every other field, each citing the vendor page that documents it.
 * `__tests__/google-fidelity.test.ts` checks every real response against
 * these lists.
 */

const cite = (source: string, ...fields: string[]): EnvelopeField[] =>
  fields.map((field) => ({ field, source }));

const TOKEN_PAGE =
  'https://developers.google.com/identity/protocols/oauth2/web-server';
const CHANNELS_PAGE = 'https://developers.google.com/youtube/v3/docs/channels';
const VIDEOS_PAGE = 'https://developers.google.com/youtube/v3/docs/videos';
const THUMBNAILS_PAGE =
  'https://developers.google.com/youtube/v3/docs/thumbnails/set';
const PLAYLIST_ITEMS_PAGE =
  'https://developers.google.com/youtube/v3/docs/playlistItems';
const QUERY_PAGE =
  'https://developers.google.com/youtube/analytics/reference/reports/query';
const JOBS_PAGE =
  'https://developers.google.com/youtube/reporting/v1/reference/rest/v1/jobs';
const REPORTS_PAGE =
  'https://developers.google.com/youtube/reporting/v1/reference/rest/v1/jobs.reports';
const ERRORS_PAGE = 'https://developers.google.com/youtube/v3/docs/errors';

const VIDEO_FIELDS_NOT_READ = [
  'kind',
  'etag',
  'pageInfo',
  'totalResults',
  'resultsPerPage',
  'default',
  'medium',
  'width',
  'height',
  'description',
  'channelId',
  'channelTitle',
  'tags',
  'categoryId',
  'dimension',
  'definition',
  'caption',
  'status',
  'uploadStatus',
  'privacyStatus',
  'madeForKids',
  'selfDeclaredMadeForKids',
  'statistics',
  'viewCount',
  'likeCount',
  'dislikeCount',
  'favoriteCount',
  'commentCount',
];

export const GOOGLE_SERVED: readonly ServedEndpoint[] = [
  {
    origin: 'google',
    method: 'POST',
    path: '/token',
    block: 'google/oauth-token',
    reads: [
      'access_token',
      'refresh_token',
      'expires_in',
      'scope',
      'error',
      'error_description',
    ],
    envelope: cite(TOKEN_PAGE, 'token_type'),
  },
  {
    origin: 'google',
    method: 'POST',
    path: '/revoke',
    block: 'google/oauth-token',
    reads: [],
    envelope: cite(TOKEN_PAGE, 'error', 'error_description'),
  },
  {
    origin: 'google',
    method: 'GET',
    path: '/youtube/v3/channels',
    block: 'youtube/channels',
    reads: [
      'items',
      'id',
      'snippet',
      'title',
      'thumbnails',
      'default',
      'url',
      'statistics',
      'subscriberCount',
      'hiddenSubscriberCount',
    ],
    envelope: cite(
      CHANNELS_PAGE,
      'kind',
      'etag',
      'pageInfo',
      'totalResults',
      'resultsPerPage',
      'description',
      'customUrl',
      'publishedAt',
      'medium',
      'high',
      'width',
      'height',
      'viewCount',
      'videoCount',
    ),
  },
  {
    origin: 'google',
    method: 'GET',
    path: '/youtube/v3/videos',
    block: 'youtube/videos',
    reads: [
      'items',
      'id',
      'snippet',
      'title',
      'thumbnails',
      'high',
      'url',
      'publishedAt',
      'contentDetails',
      'duration',
    ],
    envelope: cite(VIDEOS_PAGE, ...VIDEO_FIELDS_NOT_READ),
  },
  {
    origin: 'google',
    method: 'POST',
    path: '/upload/youtube/v3/videos',
    block: 'youtube/videos',
    reads: ['id'],
    envelope: cite(
      VIDEOS_PAGE,
      ...VIDEO_FIELDS_NOT_READ,
      'snippet',
      'title',
      'thumbnails',
      'high',
      'url',
      'publishedAt',
    ),
  },
  {
    // videos.delete answers 204 with no body: nothing to read or cite.
    origin: 'google',
    method: 'DELETE',
    path: '/youtube/v3/videos',
    reads: [],
    envelope: [],
  },
  {
    origin: 'google',
    method: 'POST',
    path: '/upload/youtube/v3/thumbnails/set',
    block: 'youtube/thumbnails-set',
    reads: ['items', 'default', 'url'],
    envelope: cite(
      THUMBNAILS_PAGE,
      'kind',
      'etag',
      'medium',
      'high',
      'width',
      'height',
    ),
  },
  {
    origin: 'google',
    method: 'POST',
    path: '/youtube/v3/playlistItems',
    reads: [],
    envelope: cite(
      PLAYLIST_ITEMS_PAGE,
      'kind',
      'etag',
      'id',
      'snippet',
      'playlistId',
      'title',
      'position',
      'resourceId',
      'videoId',
    ),
  },
  {
    origin: 'google',
    method: 'GET',
    path: '/v2/reports',
    block: 'youtube/analytics-result',
    reads: ['rows'],
    envelope: cite(
      QUERY_PAGE,
      'kind',
      'columnHeaders',
      'name',
      'columnType',
      'dataType',
    ),
  },
  {
    origin: 'google',
    method: 'GET',
    path: '/v1/reportTypes',
    block: 'youtube/reporting-resources',
    reads: ['reportTypes', 'id'],
    envelope: cite(JOBS_PAGE, 'name', 'systemManaged'),
  },
  {
    origin: 'google',
    method: 'GET',
    path: '/v1/jobs',
    block: 'youtube/reporting-resources',
    reads: ['jobs', 'id', 'reportTypeId'],
    envelope: cite(JOBS_PAGE, 'name', 'createTime'),
  },
  {
    origin: 'google',
    method: 'POST',
    path: '/v1/jobs',
    block: 'youtube/reporting-resources',
    reads: ['id'],
    envelope: cite(JOBS_PAGE, 'reportTypeId', 'name', 'createTime'),
  },
  {
    origin: 'google',
    method: 'GET',
    path: '/v1/jobs/{jobId}/reports',
    block: 'youtube/reporting-resources',
    reads: [
      'reports',
      'id',
      'createTime',
      'startTime',
      'endTime',
      'downloadUrl',
      'nextPageToken',
    ],
    envelope: cite(REPORTS_PAGE, 'jobId'),
  },
  {
    origin: 'google',
    method: 'GET',
    path: '/v1/media/{resourceName}',
    block: 'youtube/reporting-columns',
    // CSV columns, not JSON keys: the ones csv-parsers.ts reads.
    reads: [
      'date',
      'video_id',
      'views',
      'engaged_views',
      'likes',
      'dislikes',
      'comments',
      'shares',
      'watch_time_minutes',
      'subscribers_gained',
      'subscribers_lost',
      'average_view_duration_seconds',
      'average_view_duration_percentage',
      'traffic_source_type',
      'video_thumbnail_impressions',
      'video_thumbnail_impressions_ctr',
    ],
    envelope: cite(
      'https://developers.google.com/youtube/reporting/v1/reports/channel_reports',
      'channel_id',
      'live_or_on_demand',
      'subscribed_status',
      'country_code',
      'playback_location_type',
      'traffic_source_detail',
      'device_type',
      'operating_system',
      'red_views',
      'red_watch_time_minutes',
    ),
  },
  {
    origin: 'google',
    method: 'GET',
    path: '(any error)',
    block: 'google/api-error',
    // googleapis surfaces error.message as the thrown error's message.
    reads: ['error', 'message'],
    envelope: cite(
      ERRORS_PAGE,
      'code',
      'errors',
      'domain',
      'reason',
      'location',
      'locationType',
      'status',
    ),
  },
];
