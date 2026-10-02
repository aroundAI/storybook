import type { EnvelopeField, ServedEndpoint } from '../../fields';

/**
 * What the X origin serves, endpoint by endpoint (FILM-1802 criterion 5):
 * the fields the app reads — each documented in the named field-index block —
 * and every other field, each citing the X page that documents it.
 * `__tests__/x-fidelity.test.ts` checks every real response against these
 * lists.
 */

const cite = (source: string, ...fields: string[]): EnvelopeField[] =>
  fields.map((field) => ({ field, source }));

const TOKEN_PAGE =
  'https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token';
const UPLOAD_PAGE = 'https://docs.x.com/x-api/media/media-upload-initialize';
const APPEND_PAGE = 'https://docs.x.com/x-api/media/media-upload-append';
const FINALIZE_PAGE = 'https://docs.x.com/x-api/media/media-upload-finalize';
const STATUS_PAGE = 'https://docs.x.com/x-api/media/media-upload-status';
const CREATE_PAGE = 'https://docs.x.com/x-api/posts/create-post';
const LOOKUP_PAGE = 'https://docs.x.com/x-api/posts/get-post-by-id';
const DICTIONARY_PAGE = 'https://docs.x.com/x-api/fundamentals/data-dictionary';
const ERRORS_PAGE =
  'https://docs.x.com/x-api/fundamentals/response-codes-and-errors';

const PROCESSING_INFO = ['state', 'progress_percent', 'check_after_secs'];

const POST_METRIC_MEMBERS = [
  'retweet_count',
  'reply_count',
  'like_count',
  'quote_count',
  'bookmark_count',
  'impression_count',
  'url_link_clicks',
  'user_profile_clicks',
  'engagements',
];

/** What FILM-1727's X analytics provider reads from the posts lookup. */
const ANALYTICS_READS = [
  'data',
  'id',
  'public_metrics',
  'non_public_metrics',
  'attachments',
  'media_keys',
  'includes',
  'media',
  'media_key',
  'type',
];

export const X_SERVED: readonly ServedEndpoint[] = [
  {
    origin: 'x',
    method: 'POST',
    path: '/2/oauth2/token',
    block: 'x/oauth-token',
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
    origin: 'x',
    method: 'POST',
    path: '/2/oauth2/revoke',
    block: 'x/oauth-token',
    reads: [],
    envelope: cite(TOKEN_PAGE, 'revoked', 'error', 'error_description'),
  },
  {
    origin: 'x',
    method: 'GET',
    path: '/2/users/me',
    block: 'x/users-me',
    reads: ['data', 'id', 'username', 'name', 'profile_image_url'],
    envelope: [],
  },
  {
    origin: 'x',
    method: 'POST',
    path: '/2/media/upload/initialize',
    block: 'x/media-upload',
    reads: ['data', 'id'],
    envelope: cite(UPLOAD_PAGE, 'media_key', 'expires_after_secs'),
  },
  {
    origin: 'x',
    method: 'POST',
    path: '/2/media/upload/{id}/append',
    block: 'x/media-upload',
    reads: [],
    envelope: cite(APPEND_PAGE, 'data', 'expires_at'),
  },
  {
    origin: 'x',
    method: 'POST',
    path: '/2/media/upload/{id}/finalize',
    block: 'x/media-upload',
    reads: ['data', 'processing_info', ...PROCESSING_INFO],
    envelope: cite(
      FINALIZE_PAGE,
      'id',
      'media_key',
      'size',
      'expires_after_secs',
      'video',
      'video_type',
    ),
  },
  {
    origin: 'x',
    method: 'GET',
    path: '/2/media/upload',
    block: 'x/media-upload',
    reads: ['data', 'processing_info', ...PROCESSING_INFO],
    envelope: cite(
      STATUS_PAGE,
      'id',
      'media_key',
      'expires_after_secs',
      'video',
      'video_type',
    ),
  },
  {
    origin: 'x',
    method: 'POST',
    path: '/2/tweets',
    block: 'x/post-create',
    reads: ['data', 'id'],
    envelope: cite(CREATE_PAGE, 'text', 'edit_history_post_ids'),
  },
  {
    origin: 'x',
    method: 'DELETE',
    path: '/2/tweets/{id}',
    block: 'x/post-delete',
    reads: ['data', 'deleted'],
    envelope: [],
  },
  {
    origin: 'x',
    method: 'GET',
    path: '/2/tweets/{id}',
    block: 'x/post-lookup',
    reads: [],
    envelope: [
      ...cite(
        LOOKUP_PAGE,
        'data',
        'id',
        'text',
        'edit_history_post_ids',
        'created_at',
        'author_id',
        'attachments',
        'media_keys',
        'public_metrics',
        'non_public_metrics',
        'organic_metrics',
        'includes',
        'media',
        'media_key',
        'type',
        'preview_image_url',
        'errors',
      ),
      ...cite(DICTIONARY_PAGE, ...POST_METRIC_MEMBERS),
      ...cite(
        DICTIONARY_PAGE,
        'playback_0_count',
        'playback_25_count',
        'playback_50_count',
        'playback_75_count',
        'playback_100_count',
        'view_count',
      ),
      ...cite(
        ERRORS_PAGE,
        'value',
        'detail',
        'title',
        'resource_type',
        'parameter',
        'resource_id',
      ),
    ],
  },
  {
    origin: 'x',
    method: 'GET',
    path: '/2/tweets',
    block: 'x/post-lookup',
    reads: ANALYTICS_READS,
    envelope: [
      ...cite(
        LOOKUP_PAGE,
        'data',
        'id',
        'text',
        'edit_history_post_ids',
        'created_at',
        'author_id',
        'attachments',
        'media_keys',
        'public_metrics',
        'non_public_metrics',
        'organic_metrics',
        'includes',
        'media',
        'media_key',
        'type',
        'preview_image_url',
        'errors',
      ),
      ...cite(DICTIONARY_PAGE, ...POST_METRIC_MEMBERS),
      ...cite(
        DICTIONARY_PAGE,
        'playback_0_count',
        'playback_25_count',
        'playback_50_count',
        'playback_75_count',
        'playback_100_count',
        'view_count',
      ),
      ...cite(
        ERRORS_PAGE,
        'value',
        'detail',
        'title',
        'resource_type',
        'parameter',
        'resource_id',
      ),
    ],
  },
  {
    origin: 'x',
    method: 'GET',
    path: '(any error)',
    block: 'x/api-error',
    reads: [],
    envelope: cite(
      ERRORS_PAGE,
      'title',
      'detail',
      'type',
      'status',
      'errors',
      'message',
      'value',
      'resource_type',
      'parameter',
      'resource_id',
      'client_id',
      'registration_url',
      'required_enrollment',
      'reason',
    ),
  },
];
