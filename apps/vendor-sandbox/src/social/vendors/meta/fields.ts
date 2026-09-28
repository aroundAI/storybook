import type { EnvelopeField, ServedEndpoint } from '../../fields';

/**
 * What the Meta origin serves, endpoint by endpoint (FILM-1802 criterion 5):
 * the fields the app reads — each documented in the named field-index block
 * — and every other field, each citing the Meta page that documents it.
 * `__tests__/meta-fidelity.test.ts` checks every real response against
 * these lists.
 */

const cite = (source: string, ...fields: string[]): EnvelopeField[] =>
  fields.map((field) => ({ field, source }));

const ERRORS_PAGE =
  'https://developers.facebook.com/docs/graph-api/guides/error-handling/';
const PAGINATION_PAGE =
  'https://developers.facebook.com/docs/graph-api/results/';
const PICTURE_PAGE =
  'https://developers.facebook.com/docs/graph-api/reference/page/picture/';
const USER_INSIGHTS_PAGE =
  'https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/';
const MEDIA_INSIGHTS_PAGE =
  'https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/';
const MEDIA_PAGE =
  'https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/';

/** The insights envelope: a list of metric items, each with its values. */
const INSIGHTS_ENVELOPE = [
  ...cite(
    USER_INSIGHTS_PAGE,
    'data',
    'name',
    'period',
    'id',
    'total_value',
    'value',
  ),
  ...cite(
    USER_INSIGHTS_PAGE,
    'breakdowns',
    'dimension_keys',
    'results',
    'dimension_values',
  ),
];

export const META_SERVED: readonly ServedEndpoint[] = [
  {
    origin: 'meta',
    method: 'GET',
    path: '/{version}/oauth/access_token',
    block: 'meta/oauth-token',
    reads: ['access_token', 'expires_in'],
    envelope: cite(
      'https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/',
      'token_type',
    ),
  },
  {
    origin: 'meta',
    method: 'GET',
    path: '/{version}/me/accounts',
    block: 'facebook/user-accounts',
    reads: [
      'id',
      'name',
      'access_token',
      'category',
      'picture',
      'instagram_business_account',
    ],
    envelope: [
      ...cite(PAGINATION_PAGE, 'data', 'paging', 'cursors', 'before', 'after'),
      ...cite(PICTURE_PAGE, 'url'),
    ],
  },
  {
    origin: 'meta',
    method: 'GET',
    path: '/{version}/me/permissions',
    block: 'facebook/user-permissions',
    reads: ['permission', 'status'],
    envelope: cite(PAGINATION_PAGE, 'data'),
  },
  {
    origin: 'meta',
    method: 'GET',
    path: '/{version}/{ig-user-id}',
    block: 'instagram/user-fields',
    reads: ['id', 'username', 'name', 'profile_picture_url', 'followers_count'],
    envelope: [],
  },
  {
    origin: 'meta',
    method: 'GET',
    path: '/{version}/{ig-media-id}',
    block: 'instagram/media-fields',
    reads: ['media_type', 'media_product_type', 'permalink'],
    envelope: cite(MEDIA_PAGE, 'id'),
  },
  {
    origin: 'meta',
    method: 'GET',
    path: '/{version}/{ig-media-id}/insights',
    block: 'instagram/media-insights',
    reads: [
      'views',
      'reach',
      'total_interactions',
      'likes',
      'comments',
      'saved',
      'shares',
      'ig_reels_avg_watch_time',
      'ig_reels_video_view_total_time',
    ],
    envelope: cite(
      MEDIA_INSIGHTS_PAGE,
      'data',
      'name',
      'period',
      'values',
      'value',
      'id',
    ),
  },
  {
    origin: 'meta',
    method: 'GET',
    path: '/{version}/{ig-user-id}/insights',
    block: 'instagram/user-insights',
    reads: ['reach', 'views', 'follower_demographics'],
    envelope: INSIGHTS_ENVELOPE,
  },
  {
    origin: 'meta',
    method: 'POST',
    path: '/{version}/{ig-user-id}/media',
    block: 'instagram/container-fields',
    reads: [],
    envelope: cite(
      'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media',
      'id',
    ),
  },
  {
    origin: 'meta',
    method: 'GET',
    path: '/{version}/{ig-container-id}',
    block: 'instagram/container-fields',
    reads: ['status_code', 'status'],
    envelope: cite(
      'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-container',
      'id',
    ),
  },
  {
    origin: 'meta',
    method: 'POST',
    path: '/{version}/{ig-user-id}/media_publish',
    block: 'instagram/container-fields',
    reads: [],
    envelope: cite(
      'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media_publish/',
      'id',
    ),
  },
  {
    origin: 'meta',
    method: 'POST',
    path: '/{version}/{page-id}/video_reels',
    block: 'facebook/reels-publishing',
    reads: ['video_id', 'upload_url', 'success'],
    envelope: [],
  },
  {
    origin: 'meta',
    method: 'POST',
    path: '/video-upload/{version}/{video-id}',
    block: 'facebook/reels-publishing',
    reads: ['success'],
    envelope: [],
  },
  {
    origin: 'meta',
    method: 'GET',
    path: '/{version}/{video-id}',
    block: 'facebook/reels-publishing',
    reads: ['video_status'],
    envelope: cite(
      'https://developers.facebook.com/docs/video-api/guides/reels-publishing/',
      'status',
      'id',
    ),
  },
  {
    origin: 'meta',
    method: 'GET',
    path: '(any error)',
    reads: [],
    envelope: cite(
      ERRORS_PAGE,
      'error',
      'message',
      'type',
      'code',
      'error_subcode',
      'fbtrace_id',
    ),
  },
];
