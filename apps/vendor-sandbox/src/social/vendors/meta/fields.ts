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
const VIDEO_PAGE =
  'https://developers.facebook.com/docs/graph-api/reference/video/';
const COMMENTS_PAGE =
  'https://developers.facebook.com/docs/graph-api/reference/object/comments/';
const VIDEO_INSIGHTS_PAGE =
  'https://developers.facebook.com/docs/graph-api/reference/video/video_insights/';
const POST_PAGE =
  'https://developers.facebook.com/docs/graph-api/reference/post/';
const PAGE_INSIGHTS_PAGE =
  'https://developers.facebook.com/docs/graph-api/reference/insights/';

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
    reads: [
      'media_type',
      'media_product_type',
      'permalink',
      'reposts_count',
      'total_views_count',
      'total_like_count',
      'total_comments_count',
    ],
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
      'reels_skip_rate',
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
    reads: ['video_status', 'permalink_url'],
    envelope: cite(
      'https://developers.facebook.com/docs/video-api/guides/reels-publishing/',
      'status',
      'id',
    ),
  },
  {
    origin: 'meta',
    method: 'DELETE',
    path: '/{version}/{video-id}',
    block: 'facebook/reels-publishing',
    reads: ['success'],
    envelope: [],
  },
  {
    origin: 'meta',
    method: 'GET',
    path: '/{version}/{video-id}?fields=post_id',
    block: 'facebook/video-fields',
    reads: ['post_id', 'comments'],
    envelope: [
      ...cite(VIDEO_PAGE, 'id'),
      ...cite(COMMENTS_PAGE, 'data', 'summary', 'total_count'),
    ],
  },
  {
    origin: 'meta',
    method: 'GET',
    path: '/{version}/{video-id}/video_insights',
    block: 'facebook/video-insights',
    reads: [
      'total_video_views',
      'total_video_views_organic',
      'total_video_views_paid',
      'total_video_views_autoplayed',
      'total_video_views_clicked_to_play',
      'total_video_15s_views',
      'total_video_complete_views',
      'total_video_view_total_time',
      'total_video_retention_graph',
      'total_video_reactions_by_type_total',
      'blue_reels_play_count',
      'fb_reels_replay_count',
      'post_video_view_time',
      'post_video_followers',
      'post_video_likes_by_reaction_type',
      'total_video_views_by_age_bucket_and_gender',
      'total_video_views_by_country_id',
    ],
    envelope: [
      ...cite(
        VIDEO_INSIGHTS_PAGE,
        'data',
        'name',
        'period',
        'values',
        'value',
        'id',
      ),
      // Inside a value: the reaction types of the `…_by_reaction_type`
      // metrics, and the retention graph's "40 equal intervals" (0–40).
      ...cite(VIDEO_INSIGHTS_PAGE, 'like', 'love'),
      ...cite(
        VIDEO_INSIGHTS_PAGE,
        ...Array.from({ length: 41 }, (_, interval) => String(interval)),
      ),
      // Inside a breakdown value: `{F|M|U}.{age bucket}`, and countries.
      ...cite(
        VIDEO_INSIGHTS_PAGE,
        ...['18-24', '25-34', '35-44', '45-54', '55-64'].flatMap((age) =>
          ['F', 'M', 'U'].map((gender) => `${gender}.${age}`),
        ),
        'US',
        'GB',
        'IN',
        'CA',
        'AU',
      ),
    ],
  },
  {
    origin: 'meta',
    method: 'GET',
    path: '/{version}/{page-id}?fields=followers_count',
    block: 'facebook/page-fields',
    reads: ['followers_count'],
    envelope: cite(
      'https://developers.facebook.com/docs/graph-api/reference/page/',
      'id',
    ),
  },
  {
    origin: 'meta',
    method: 'GET',
    path: '/{version}/{page-id}/insights',
    block: 'facebook/page-insights',
    reads: ['page_total_media_view_unique'],
    envelope: cite(
      PAGE_INSIGHTS_PAGE,
      'data',
      'name',
      'period',
      'values',
      'value',
      'end_time',
      'id',
    ),
  },
  {
    origin: 'meta',
    method: 'GET',
    path: '/{version}/{post-id}',
    block: 'facebook/post-fields',
    reads: ['shares'],
    envelope: cite(POST_PAGE, 'id', 'count'),
  },
  {
    origin: 'meta',
    method: 'GET',
    path: '/{version}/{post-id}/insights',
    block: 'facebook/post-insights',
    reads: ['post_media_view', 'post_total_media_view_unique'],
    envelope: cite(
      PAGE_INSIGHTS_PAGE,
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
