import type { EnvelopeField, ServedEndpoint } from '../../fields';

/**
 * What the LinkedIn origin serves, endpoint by endpoint (FILM-1802 criterion
 * 5): the fields the app reads — each documented in the named field-index
 * block — and every other field, each citing the LinkedIn page that
 * documents it. `__tests__/linkedin-fidelity.test.ts` checks every real
 * response against these lists.
 */

const cite = (source: string, ...fields: string[]): EnvelopeField[] =>
  fields.map((field) => ({ field, source }));

const LEARN = 'https://learn.microsoft.com/en-us/linkedin';
const TOKEN_PAGE = `${LEARN}/shared/authentication/authorization-code-flow`;
const USERINFO_PAGE = `${LEARN}/consumer/integrations/self-serve/sign-in-with-linkedin-v2`;
const VIDEOS_PAGE = `${LEARN}/marketing/community-management/shares/videos-api`;
const POSTS_PAGE = `${LEARN}/marketing/community-management/shares/posts-api`;
const ASSETS_PAGE = `${LEARN}/marketing/community-management/shares/vector-asset-api`;
const ERRORS_PAGE = `${LEARN}/shared/api-guide/concepts/error-handling`;

const POST_FIELDS = [
  'id',
  'author',
  'commentary',
  'visibility',
  'lifecycleState',
  'lifecycleStateInfo',
  'isEditedByAuthor',
  'isReshareDisabledByAuthor',
  'distribution',
  'feedDistribution',
  'targetEntities',
  'thirdPartyDistributionChannels',
  'content',
  'media',
  'createdAt',
  'publishedAt',
  'lastModifiedAt',
];

export const LINKEDIN_SERVED: readonly ServedEndpoint[] = [
  {
    origin: 'linkedin',
    method: 'POST',
    path: '/oauth/v2/accessToken',
    block: 'linkedin/oauth-token',
    reads: [
      'access_token',
      'refresh_token',
      'expires_in',
      'error',
      'error_description',
    ],
    envelope: cite(TOKEN_PAGE, 'refresh_token_expires_in', 'scope'),
  },
  {
    origin: 'linkedin',
    method: 'GET',
    path: '/v2/userinfo',
    block: 'linkedin/userinfo',
    reads: ['sub', 'name', 'given_name', 'family_name', 'picture', 'email'],
    envelope: cite(USERINFO_PAGE, 'locale', 'email_verified'),
  },
  {
    origin: 'linkedin',
    method: 'POST',
    path: '/v2/videos?action=initializeUpload',
    block: 'linkedin/videos',
    reads: ['value', 'uploadInstructions', 'uploadUrl', 'video'],
    envelope: cite(
      VIDEOS_PAGE,
      'uploadUrlsExpireAt',
      'firstByte',
      'lastByte',
      'uploadToken',
    ),
  },
  {
    origin: 'linkedin',
    method: 'GET',
    path: '/v2/videos/{urn}',
    block: 'linkedin/videos',
    reads: ['status'],
    envelope: cite(
      VIDEOS_PAGE,
      'id',
      'owner',
      'duration',
      'aspectRatioWidth',
      'aspectRatioHeight',
    ),
  },
  {
    origin: 'linkedin',
    method: 'POST',
    path: '/v2/assets?action=registerUpload',
    block: 'linkedin/assets',
    reads: ['value', 'asset', 'uploadMechanism', 'uploadUrl'],
    envelope: cite(
      ASSETS_PAGE,
      'mediaArtifact',
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest',
      'headers',
      'media-type-family',
      'assetRealTimeTopic',
    ),
  },
  {
    origin: 'linkedin',
    method: 'POST',
    path: '/v2/ugcPosts',
    block: 'linkedin/ugc-posts',
    reads: ['id'],
    envelope: [],
  },
  {
    origin: 'linkedin',
    method: 'POST',
    path: '/v2/posts',
    block: 'linkedin/posts',
    reads: [],
    envelope: [],
  },
  {
    origin: 'linkedin',
    method: 'GET',
    path: '/v2/posts/{urn}',
    block: 'linkedin/posts',
    reads: [],
    envelope: cite(POSTS_PAGE, ...POST_FIELDS),
  },
  {
    origin: 'linkedin',
    method: 'GET',
    path: '(any error)',
    block: 'linkedin/api-error',
    reads: [],
    envelope: cite(
      ERRORS_PAGE,
      'message',
      'serviceErrorCode',
      'status',
      'code',
    ),
  },
];
