import { sendJson } from '../../../http';
import { mediaUrl } from '../../media';
import type { SocialRequest, SocialRoute } from '../../server';
import type { SocialObject, SocialState, SocialToken } from '../../state';
import {
  SCOPE,
  accessDenied,
  authorize,
  badRequest,
  linkedInError,
  notFound,
  personUrn,
} from './errors';

/**
 * LinkedIn, the calls the app makes: the OpenID Connect userinfo (connect),
 * the Videos API (initializeUpload, the part upload, finalizeUpload, get a
 * video), the Posts API (create, get, delete) and — because the publish
 * worker still calls them — the Assets API's registerUpload and the ugcPosts
 * create. `/v2` and `/rest` answer alike. No analytics: the app syncs none
 * (FILM-1720, FILM-1727), so no call site exists to serve (§8).
 */

const UPLOADS = 'linkedin-uploads';
const DELETED = 'deleted:linkedin';
const MAX_COMMENTARY = 3000;
const PART_BYTES = 4_194_304;

/** Real time LinkedIn takes to process an uploaded video, as the social clock reads it. */
export const PROCESSING_MS = 3_000;

type Json = Record<string, unknown>;

interface Upload {
  kind: 'video' | 'asset';
  urn: string;
  key: string;
  ownerUrn: string;
  accountId: string;
  fileSizeBytes: number;
  uploadedBytes: number;
  etags: string[];
  createdMs: number;
  finalizedMs?: number;
}

const VISIBILITIES = ['PUBLIC', 'CONNECTIONS', 'LOGGED_IN', 'CONTAINER'];

function objectAt(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function jsonBody(body: Buffer): Json {
  try {
    return objectAt(JSON.parse(body.toString('utf8')));
  } catch {
    return {};
  }
}

/** `/v2/videos` and `/rest/videos` are the same resource. */
function resourcePath(pathname: string) {
  return /^\/(?:v2|rest)(\/.*)$/.exec(pathname)?.[1] ?? null;
}

function uploads(social: SocialState) {
  return social.list<Upload>(UPLOADS);
}

function videoStatus(upload: Upload, nowMs: number) {
  if (!upload.finalizedMs) return 'WAITING_UPLOAD';
  return nowMs - upload.finalizedMs >= PROCESSING_MS
    ? 'AVAILABLE'
    : 'PROCESSING';
}

function ownsUrn(token: SocialToken, urn: string) {
  if (urn === personUrn(token.accountId))
    return token.scopes.includes(SCOPE.writeMember);
  return (
    urn.startsWith('urn:li:organization:') &&
    token.scopes.includes(SCOPE.writeOrganization)
  );
}

/** GET /v2/userinfo — OpenID Connect; `profile` and `email` gate their claims. */
const userinfo: SocialRoute = ({ url, method, req, res, social, self }) => {
  if (method !== 'GET' || resourcePath(url.pathname) !== '/userinfo')
    return false;
  const token = authorize(req, res, social, {
    resource: 'userinfo',
    method: 'GET',
    all: [SCOPE.openid],
  });
  if (!token) return true;

  const account = social.account('linkedin', token.accountId)!;
  const [given = '', ...rest] = account.name.split(' ');
  const family = rest.join(' ');
  const rng = social.rngFor(`linkedin-email:${account.id}`);
  const claims: Json = { sub: account.id };
  if (token.scopes.includes(SCOPE.profile)) {
    claims.name = account.name;
    claims.given_name = given;
    claims.family_name = family;
    claims.picture = mediaUrl(self, 'avatar', account.id, account.name);
    claims.locale = 'en-US';
  }
  if (token.scopes.includes(SCOPE.email)) {
    claims.email =
      `${given}.${family.replace(/\s+/g, '')}@${rng.pick(['outlook.com', 'fastmail.com', 'proton.me'])}`.toLowerCase();
    claims.email_verified = true;
  }
  sendJson(res, 200, claims);
  return true;
};

function initializeResponse(
  self: string,
  upload: Upload,
  parts: number,
  nowMs: number,
) {
  const base = `${self}/dms-uploads/${upload.key}/uploadedVideo`;
  return {
    value: {
      uploadUrlsExpireAt: nowMs + 30 * 86_400_000,
      video: upload.urn,
      uploadInstructions: Array.from({ length: parts }, (_, i) => ({
        uploadUrl: `${base}?part=${i}&sau=${upload.key}`,
        lastByte: Math.min((i + 1) * PART_BYTES, upload.fileSizeBytes) - 1,
        firstByte: i * PART_BYTES,
      })),
      uploadToken: '',
    },
  };
}

function newUpload(
  social: SocialState,
  kind: Upload['kind'],
  token: SocialToken,
  ownerUrn: string,
  fileSizeBytes: number,
) {
  const key = `C5505AQ${social.recordId('linkedin-upload', 9)}`;
  return social.add<Upload>(UPLOADS, {
    kind,
    urn:
      kind === 'video'
        ? `urn:li:video:${key}`
        : `urn:li:digitalmediaAsset:${key}`,
    key,
    ownerUrn,
    accountId: token.accountId,
    fileSizeBytes,
    uploadedBytes: 0,
    etags: [],
    createdMs: social.now(),
  });
}

/** POST /videos?action=initializeUpload */
const videosInitialize: SocialRoute = ({
  url,
  method,
  req,
  res,
  body,
  social,
  self,
}) => {
  if (
    method !== 'POST' ||
    resourcePath(url.pathname) !== '/videos' ||
    url.searchParams.get('action') !== 'initializeUpload'
  )
    return false;
  const token = authorize(req, res, social, {
    resource: 'videos',
    method: 'ACTION',
    anyOf: [SCOPE.writeMember, SCOPE.writeOrganization],
  });
  if (!token) return true;

  const request = objectAt(jsonBody(body).initializeUploadRequest);
  const owner = String(request.owner ?? '');
  const size = Number(request.fileSizeBytes);
  if (!owner.startsWith('urn:li:') || !Number.isInteger(size) || size <= 0) {
    sendJson(
      res,
      400,
      badRequest(
        'INVALID_URN_TYPE',
        'owner must be a person or organization URN and fileSizeBytes a positive number',
      ),
    );
    return true;
  }
  if (!ownsUrn(token, owner)) {
    sendJson(
      res,
      403,
      linkedInError(
        403,
        'Accessing this video resource is forbidden. Please check your permissions for this resource',
      ),
    );
    return true;
  }

  const upload = newUpload(social, 'video', token, owner, size);
  sendJson(
    res,
    200,
    initializeResponse(
      self,
      upload,
      Math.ceil(size / PART_BYTES),
      social.now(),
    ),
  );
  return true;
};

/** PUT or POST to an upload URL: the bytes, and the part's ETag. */
const uploadPart: SocialRoute = ({ url, method, res, body, social, about }) => {
  const match = /^\/dms-uploads\/([^/]+)\/uploadedVideo$/.exec(url.pathname);
  if ((method !== 'PUT' && method !== 'POST') || !match) return false;

  const upload = uploads(social).find((u) => u.key === match[1]);
  if (!upload) {
    sendJson(res, 404, notFound());
    return true;
  }
  about(upload.urn);
  upload.uploadedBytes += body.length;
  const etag = `/ambry-videoei/signedId/${social.recordId('linkedin-etag', 40)}.bin`;
  upload.etags.push(etag);
  res.writeHead(200, { 'content-length': 0, etag });
  res.end();
  return true;
};

/** POST /videos?action=finalizeUpload */
const videosFinalize: SocialRoute = ({
  url,
  method,
  req,
  res,
  body,
  social,
  about,
}) => {
  if (
    method !== 'POST' ||
    resourcePath(url.pathname) !== '/videos' ||
    url.searchParams.get('action') !== 'finalizeUpload'
  )
    return false;
  const token = authorize(req, res, social, {
    resource: 'videos',
    method: 'ACTION',
    anyOf: [SCOPE.writeMember, SCOPE.writeOrganization],
  });
  if (!token) return true;

  const request = objectAt(jsonBody(body).finalizeUploadRequest);
  const urn = String(request.video ?? '');
  const upload = uploads(social).find(
    (u) =>
      u.kind === 'video' && u.urn === urn && u.accountId === token.accountId,
  );
  if (!upload) {
    sendJson(
      res,
      400,
      badRequest('INVALID_VIDEO_ID', 'This Video ID is invalid'),
    );
    return true;
  }
  about(urn);
  if (upload.uploadedBytes === 0) {
    sendJson(
      res,
      400,
      badRequest('MEDIA_ASSET_WAITING_UPLOAD', 'Media asset is waiting upload'),
    );
    return true;
  }
  const ids = Array.isArray(request.uploadedPartIds)
    ? request.uploadedPartIds.map(String)
    : [];
  if (ids.length > 0 && ids.some((id) => !upload.etags.includes(id))) {
    sendJson(
      res,
      400,
      badRequest(
        'INVALID_VALUE_FOR_FIELD',
        'uploadedPartIds does not match the uploaded parts',
      ),
    );
    return true;
  }
  upload.finalizedMs ??= social.now();
  res.writeHead(200, { 'content-length': 0 });
  res.end();
  return true;
};

/** GET /videos/{urn} */
const videosGet: SocialRoute = ({ url, method, req, res, social, about }) => {
  const path = resourcePath(url.pathname);
  const match = path && /^\/videos\/(.+)$/.exec(path);
  if (method !== 'GET' || !match) return false;
  const token = authorize(req, res, social, {
    resource: 'videos',
    method: 'GET',
    anyOf: [SCOPE.writeMember, SCOPE.writeOrganization],
  });
  if (!token) return true;

  const urn = decodeURIComponent(match[1]!);
  about(urn);
  const upload = uploads(social).find(
    (u) => u.kind === 'video' && u.urn === urn,
  );
  if (!upload) {
    sendJson(res, 404, notFound());
    return true;
  }
  const status = videoStatus(upload, social.now());
  sendJson(res, 200, {
    id: upload.urn,
    owner: upload.ownerUrn,
    status,
    ...(status === 'AVAILABLE'
      ? { duration: 30_000, aspectRatioWidth: 9, aspectRatioHeight: 16 }
      : {}),
  });
  return true;
};

/** POST /assets?action=registerUpload — the Assets API the publish worker uses. */
const assetsRegister: SocialRoute = ({
  url,
  method,
  req,
  res,
  body,
  social,
  self,
}) => {
  if (
    method !== 'POST' ||
    resourcePath(url.pathname) !== '/assets' ||
    url.searchParams.get('action') !== 'registerUpload'
  )
    return false;
  const token = authorize(req, res, social, {
    resource: 'assets',
    method: 'ACTION',
    anyOf: [SCOPE.writeMember, SCOPE.writeOrganization],
  });
  if (!token) return true;

  const request = objectAt(jsonBody(body).registerUploadRequest);
  const owner = String(request.owner ?? '');
  if (!ownsUrn(token, owner)) {
    sendJson(res, 403, accessDenied('assets', 'ACTION'));
    return true;
  }
  const asset = newUpload(social, 'asset', token, owner, 1);
  // The asset is usable once its bytes arrive; the Assets API has no finalize.
  asset.finalizedMs = social.now();
  sendJson(res, 200, {
    value: {
      mediaArtifact: `urn:li:digitalmediaMediaArtifact:(${asset.urn},urn:li:digitalmediaMediaArtifactClass:uploadedVideo)`,
      uploadMechanism: {
        'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': {
          headers: { 'media-type-family': 'VIDEO' },
          uploadUrl: `${self}/dms-uploads/${asset.key}/uploadedVideo`,
        },
      },
      asset: asset.urn,
      assetRealTimeTopic: `urn:li-realtime:digitalmediaAssetUpdatesTopic:${asset.urn}`,
    },
  });
  return true;
};

function postResource(object: SocialObject) {
  const d = object.details ?? {};
  const published = object.publishedMs;
  return {
    id: object.id,
    author: String(d.authorUrn ?? ''),
    commentary: object.caption,
    visibility: String(d.visibility ?? 'PUBLIC'),
    lifecycleState: 'PUBLISHED',
    lifecycleStateInfo: { isEditedByAuthor: false },
    isReshareDisabledByAuthor: false,
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    ...(typeof d.videoUrn === 'string'
      ? { content: { media: { id: d.videoUrn } } }
      : {}),
    createdAt: published,
    publishedAt: published,
    lastModifiedAt: published,
  };
}

function createdResponse(
  res: SocialRequest['res'],
  id: string,
  withBody: boolean,
) {
  const payload = withBody ? JSON.stringify({ id }) : '';
  res.writeHead(201, {
    'x-restli-id': id,
    ...(withBody ? { 'content-type': 'application/json' } : {}),
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** The video a post attaches, if it is one the author uploaded and is ready. */
function attachableMedia(
  social: SocialState,
  token: SocialToken,
  urn: string,
): { ok: true } | { ok: false; error: Json } {
  const upload = uploads(social).find(
    (u) => u.urn === urn && u.accountId === token.accountId,
  );
  if (!upload) {
    return {
      ok: false,
      error: badRequest('INVALID_URN_ID', 'This URN Id is invalid'),
    };
  }
  if (videoStatus(upload, social.now()) === 'WAITING_UPLOAD') {
    return {
      ok: false,
      error: badRequest(
        'MEDIA_ASSET_WAITING_UPLOAD',
        'Media asset is waiting upload',
      ),
    };
  }
  return { ok: true };
}

function authorOk(
  ctx: SocialRequest,
  token: SocialToken,
  author: string,
  resource: string,
) {
  if (!ownsUrn(token, author)) {
    sendJson(ctx.res, 403, accessDenied(resource, 'CREATE'));
    return false;
  }
  return true;
}

/** POST /posts — 201, the id in `x-restli-id`, and no body. */
const postsCreate: SocialRoute = (ctx) => {
  const { url, method, req, res, body, social, about } = ctx;
  if (method !== 'POST' || resourcePath(url.pathname) !== '/posts')
    return false;
  const token = authorize(req, res, social, {
    resource: 'partnerApiPostsExternal',
    method: 'CREATE',
    anyOf: [SCOPE.writeMember, SCOPE.writeOrganization],
  });
  if (!token) return true;

  const post = jsonBody(body);
  const author = String(post.author ?? '');
  const commentary = typeof post.commentary === 'string' ? post.commentary : '';
  const visibility = String(post.visibility ?? '');
  const mediaId = String(objectAt(objectAt(post.content).media).id ?? '');

  const missing = [
    'author',
    'visibility',
    'distribution',
    'lifecycleState',
  ].find((field) => post[field] === undefined);
  if (missing) {
    sendJson(
      res,
      400,
      badRequest('MISSING_FIELD', `Field ${missing} is required`),
    );
    return true;
  }
  if (!authorOk(ctx, token, author, 'partnerApiPostsExternal')) return true;
  if (
    !VISIBILITIES.includes(visibility) ||
    post.lifecycleState !== 'PUBLISHED'
  ) {
    sendJson(
      res,
      400,
      badRequest(
        'INVALID_VALUE_FOR_FIELD',
        'visibility or lifecycleState cannot be set to that value',
      ),
    );
    return true;
  }
  if (commentary.length > MAX_COMMENTARY) {
    sendJson(
      res,
      400,
      badRequest(
        'FIELD_LENGTH_TOO_LONG',
        'commentary length exceeds the allowed maximum',
      ),
    );
    return true;
  }
  if (mediaId) {
    const media = attachableMedia(social, token, mediaId);
    if (!media.ok) {
      sendJson(res, 400, media.error);
      return true;
    }
  }

  const object = social.createObject('linkedin', token.accountId, {
    title:
      String(objectAt(objectAt(post.content).media).title ?? '') ||
      commentary.split('\n')[0]!.slice(0, 100),
    caption: commentary,
    details: {
      authorUrn: author,
      visibility,
      ...(mediaId ? { videoUrn: mediaId } : {}),
    },
  });
  about(object.id);
  createdResponse(res, object.id, false);
  return true;
};

/** POST /ugcPosts — the older create the publish worker calls; it answers with a body. */
const ugcPostsCreate: SocialRoute = (ctx) => {
  const { url, method, req, res, body, social, about } = ctx;
  if (method !== 'POST' || resourcePath(url.pathname) !== '/ugcPosts')
    return false;
  const token = authorize(req, res, social, {
    resource: 'ugcPosts',
    method: 'CREATE',
    anyOf: [SCOPE.writeMember, SCOPE.writeOrganization],
  });
  if (!token) return true;

  const post = jsonBody(body);
  const author = String(post.author ?? '');
  if (!authorOk(ctx, token, author, 'ugcPosts')) return true;

  const content = objectAt(
    objectAt(post.specificContent)['com.linkedin.ugc.ShareContent'],
  );
  const text = String(objectAt(content.shareCommentary).text ?? '');
  const media = Array.isArray(content.media) ? objectAt(content.media[0]) : {};
  const assetUrn = String(media.media ?? '');
  if (assetUrn) {
    const found = attachableMedia(social, token, assetUrn);
    if (!found.ok) {
      sendJson(res, 400, found.error);
      return true;
    }
  }
  const visibility = String(
    objectAt(post.visibility)['com.linkedin.ugc.MemberNetworkVisibility'] ?? '',
  );
  if (
    post.lifecycleState !== 'PUBLISHED' ||
    !VISIBILITIES.includes(visibility)
  ) {
    sendJson(
      res,
      400,
      badRequest(
        'INVALID_VALUE_FOR_FIELD',
        'lifecycleState or visibility is invalid',
      ),
    );
    return true;
  }

  const object = social.createObject('linkedin', token.accountId, {
    title: String(objectAt(media.title).text ?? text.split('\n')[0]!),
    caption: text,
    details: {
      authorUrn: author,
      visibility,
      ...(assetUrn ? { videoUrn: assetUrn } : {}),
    },
  });
  about(object.id);
  createdResponse(res, object.id, true);
  return true;
};

/** GET /posts/{urn} — reading needs r_member_social or r_organization_social. */
const postsGet: SocialRoute = ({ url, method, req, res, social, about }) => {
  const path = resourcePath(url.pathname);
  const match = path && /^\/posts\/(.+)$/.exec(path);
  if (method !== 'GET' || !match) return false;
  const token = authorize(req, res, social, {
    resource: 'partnerApiPostsExternal',
    method: 'GET',
    anyOf: [SCOPE.readMember, SCOPE.readOrganization],
  });
  if (!token) return true;

  const urn = decodeURIComponent(match[1]!);
  about(urn);
  if (
    social.list<string>(DELETED).includes(urn) ||
    !social.hasObject('linkedin', urn)
  ) {
    sendJson(res, 404, notFound('Post not found'));
    return true;
  }
  const object = social.object('linkedin', urn);
  if (object.accountId !== token.accountId) {
    sendJson(res, 403, accessDenied('partnerApiPostsExternal', 'GET'));
    return true;
  }
  sendJson(res, 200, postResource(object));
  return true;
};

/** DELETE /posts/{urn} — idempotent: 204 for a post already gone. */
const postsDelete: SocialRoute = ({ url, method, req, res, social, about }) => {
  const path = resourcePath(url.pathname);
  const match = path && /^\/posts\/(.+)$/.exec(path);
  if (method !== 'DELETE' || !match) return false;
  const token = authorize(req, res, social, {
    resource: 'partnerApiPostsExternal',
    method: 'DELETE',
    anyOf: [SCOPE.writeMember, SCOPE.writeOrganization],
  });
  if (!token) return true;

  const urn = decodeURIComponent(match[1]!);
  about(urn);
  if (social.hasObject('linkedin', urn)) {
    const object = social.object('linkedin', urn);
    if (object.accountId !== token.accountId) {
      sendJson(res, 403, accessDenied('partnerApiPostsExternal', 'DELETE'));
      return true;
    }
    social.removeObject('linkedin', urn);
    social.add(DELETED, urn);
  }
  res.writeHead(204);
  res.end();
  return true;
};

export const linkedInDataRoutes = [
  userinfo,
  videosInitialize,
  uploadPart,
  videosFinalize,
  videosGet,
  assetsRegister,
  postsCreate,
  ugcPostsCreate,
  postsGet,
  postsDelete,
];
