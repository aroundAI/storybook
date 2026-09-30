import type { EnvelopeField, ServedEndpoint } from '../../fields';

/**
 * What the TikTok origin serves, endpoint by endpoint (FILM-1802 criterion
 * 5): the fields the app reads — each documented in the named field-index
 * block — and every other field, each citing the TikTok page that documents
 * it. `__tests__/tiktok-fidelity.test.ts` checks every real response against
 * these lists.
 *
 * developers.tiktok.com refused connections from the network this was
 * written on (2026-09-30), as it did on 2026-09-21: the pages are cited, and
 * the names rest on the capability reference's own record of them.
 */

const cite = (source: string, ...fields: string[]): EnvelopeField[] =>
  fields.map((field) => ({ field, source }));

const TOKEN_PAGE =
  'https://developers.tiktok.com/doc/oauth-user-access-token-management';
const USER_PAGE =
  'https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info';
const VIDEO_PAGE =
  'https://developers.tiktok.com/doc/tiktok-api-v2-video-query';
const POST_PAGE =
  'https://developers.tiktok.com/doc/content-posting-api-reference-direct-post';
const INBOX_PAGE =
  'https://developers.tiktok.com/doc/content-posting-api-reference-upload-video';
const STATUS_PAGE =
  'https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status';
const ERRORS_PAGE =
  'https://developers.tiktok.com/doc/tiktok-api-v2-error-codes';

export const TIKTOK_SERVED: readonly ServedEndpoint[] = [
  {
    origin: 'tiktok',
    method: 'POST',
    path: '/v2/oauth/token/',
    block: 'tiktok/oauth-token',
    reads: [
      'access_token',
      'refresh_token',
      'expires_in',
      'refresh_expires_in',
      'error',
      'error_description',
    ],
    envelope: cite(TOKEN_PAGE, 'open_id', 'scope', 'token_type', 'log_id'),
  },
  {
    origin: 'tiktok',
    method: 'POST',
    path: '/v2/oauth/revoke/',
    block: 'tiktok/oauth-token',
    reads: [],
    envelope: [],
  },
  {
    origin: 'tiktok',
    method: 'GET',
    path: '/v2/user/info/',
    block: 'tiktok/user-info-response',
    reads: [
      'data',
      'user',
      'error',
      'code',
      'message',
      'open_id',
      'union_id',
      'avatar_url',
      'display_name',
      'follower_count',
    ],
    envelope: cite(
      USER_PAGE,
      'log_id',
      'avatar_url_100',
      'avatar_large_url',
      'bio_description',
      'profile_deep_link',
      'is_verified',
      'username',
      'following_count',
      'likes_count',
      'video_count',
    ),
  },
  {
    origin: 'tiktok',
    method: 'POST',
    path: '/v2/video/query/',
    block: 'tiktok/video-query-response',
    reads: [
      'data',
      'videos',
      'error',
      'code',
      'message',
      'id',
      'duration',
      'like_count',
      'comment_count',
      'share_count',
      'view_count',
    ],
    envelope: cite(
      VIDEO_PAGE,
      'log_id',
      'create_time',
      'cover_image_url',
      'share_url',
      'video_description',
      'height',
      'width',
      'title',
      'embed_html',
      'embed_link',
      'is_aigc',
    ),
  },
  {
    origin: 'tiktok',
    method: 'POST',
    path: '/v2/post/publish/inbox/video/init/',
    block: 'tiktok/publish-response',
    reads: ['data', 'publish_id', 'upload_url', 'error', 'code', 'message'],
    envelope: cite(INBOX_PAGE, 'log_id'),
  },
  {
    origin: 'tiktok',
    method: 'POST',
    path: '/v2/post/publish/video/init/',
    block: 'tiktok/publish-response',
    reads: ['data', 'publish_id', 'upload_url', 'error', 'code', 'message'],
    envelope: cite(POST_PAGE, 'log_id'),
  },
  {
    origin: 'tiktok',
    method: 'POST',
    path: '/v2/post/publish/status/fetch/',
    block: 'tiktok/publish-response',
    reads: [
      'data',
      'status',
      'publicaly_available_post_id',
      'error',
      'code',
      'message',
    ],
    envelope: cite(STATUS_PAGE, 'log_id', 'uploaded_bytes'),
  },
  {
    origin: 'tiktok',
    method: 'GET',
    path: '(any error)',
    block: 'tiktok/publish-response',
    reads: ['data', 'error', 'code', 'message'],
    envelope: cite(ERRORS_PAGE, 'log_id'),
  },
];
