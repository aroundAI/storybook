import { sendJson } from '../../../http';
import { mediaUrl } from '../../media';
import type { SocialRoute } from '../../server';
import type { SocialObject, SocialState } from '../../state';
import { SCOPE, authorize, ok, tiktokError } from './errors';
import { openIdOf } from './oauth';

/**
 * TikTok's Display and Content Posting APIs, the calls the app makes
 * (https://developers.tiktok.com/doc): user/info, video/query, the two
 * publish inits (the inbox upload and the direct post), the chunked upload to
 * the URL an init returns, and the publish status.
 *
 * Fidelity (FILM-1802 §3, TikTok): every response carries `error`, success is
 * `error.code: "ok"`; at most 20 ids to `video/query`; data stops updating 365
 * days after publish; no retention curve, saves or watch time on the Display
 * API — asking for one is `invalid_params`. `user/info` splits its fields
 * across three scopes, and a field whose scope is missing is
 * `scope_not_authorized`. The inbox init needs `video.upload`, the direct
 * post `video.publish`.
 */

const PUBLISHES = 'tiktok-publishes';
const DAY_MS = 86_400_000;

/** Data stops updating this long after a video is published. */
export const FREEZE_AFTER_MS = 365 * DAY_MS;
/** Video ids per `video/query` call. */
export const MAX_QUERY_IDS = 20;
/** Real time TikTok takes to fetch or process a video, as the social clock reads it. */
export const PROCESSING_MS = 3_000;

/** The Display API's `video/query` fields; none of the Business API's are here. */
export const DISPLAY_VIDEO_FIELDS = [
  'id',
  'create_time',
  'cover_image_url',
  'share_url',
  'video_description',
  'duration',
  'height',
  'width',
  'title',
  'embed_html',
  'embed_link',
  'like_count',
  'comment_count',
  'share_count',
  'view_count',
  'is_aigc',
] as const;

/** `user/info` fields and the scope each needs. */
export const USER_FIELD_SCOPES: Record<string, string> = {
  open_id: SCOPE.basic,
  union_id: SCOPE.basic,
  avatar_url: SCOPE.basic,
  avatar_url_100: SCOPE.basic,
  avatar_large_url: SCOPE.basic,
  display_name: SCOPE.basic,
  bio_description: SCOPE.profile,
  profile_deep_link: SCOPE.profile,
  is_verified: SCOPE.profile,
  username: SCOPE.profile,
  follower_count: SCOPE.stats,
  following_count: SCOPE.stats,
  likes_count: SCOPE.stats,
  video_count: SCOPE.stats,
};

const PRIVACY_LEVELS = [
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
];

type Json = Record<string, unknown>;

interface Publish {
  id: string;
  kind: 'inbox' | 'direct';
  source: 'FILE_UPLOAD' | 'PULL_FROM_URL';
  accountId: string;
  videoSize: number;
  uploadedBytes: number;
  uploadToken: string;
  createdMs: number;
  uploadedMs?: number;
  title: string;
  postId?: string;
}

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

function publishes(social: SocialState) {
  return social.list<Publish>(PUBLISHES);
}

function fieldList(url: URL) {
  return (url.searchParams.get('fields') ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
}

/** GET /v2/user/info/ */
const userInfo: SocialRoute = ({ url, method, req, res, social, self }) => {
  if (method !== 'GET' || url.pathname !== '/v2/user/info/') return false;
  const token = authorize(req, res, social, [
    SCOPE.basic,
    SCOPE.profile,
    SCOPE.stats,
  ]);
  if (!token) return true;

  const fields = fieldList(url);
  const unknown = fields.filter((f) => !(f in USER_FIELD_SCOPES));
  if (fields.length === 0 || unknown.length > 0) {
    sendJson(
      res,
      400,
      tiktokError(
        social,
        'invalid_params',
        fields.length === 0
          ? 'The fields parameter is required.'
          : `Invalid fields: ${unknown.join(',')}`,
      ),
    );
    return true;
  }
  const needing = fields.find(
    (f) => !token.scopes.includes(USER_FIELD_SCOPES[f]!),
  );
  if (needing) {
    sendJson(
      res,
      401,
      tiktokError(
        social,
        'scope_not_authorized',
        'The user did not authorize the scope required for completing this request.',
      ),
    );
    return true;
  }

  const account = social.account('tiktok', token.accountId)!;
  const avatar = mediaUrl(self, 'avatar', account.id, account.name);
  const all: Record<string, unknown> = {
    open_id: openIdOf(social, account.id),
    union_id: openIdOf(social, account.id, 'union'),
    avatar_url: avatar,
    avatar_url_100: avatar,
    avatar_large_url: avatar,
    display_name: account.name,
    bio_description: account.bio,
    profile_deep_link: `https://www.tiktok.com/@${account.handle}`,
    is_verified: false,
    username: account.handle,
    follower_count: social.followers(account),
    following_count: social
      .rngFor(`tiktok-following:${account.id}`)
      .int(12, 480),
    likes_count: social
      .listObjects('tiktok')
      .filter((o) => o.accountId === account.id)
      .reduce((sum, o) => sum + social.cumulative(o, 'likes'), 0),
    video_count: social
      .listObjects('tiktok')
      .filter((o) => o.accountId === account.id).length,
  };
  sendJson(
    res,
    200,
    ok(social, {
      user: Object.fromEntries(fields.map((f) => [f, all[f]])),
    }),
  );
  return true;
};

/** A metric as TikTok reports it: frozen 365 days after the video was published. */
function reported(
  social: SocialState,
  object: SocialObject,
  metric: 'views' | 'likes' | 'comments' | 'shares',
) {
  const at = Math.min(social.now(), object.publishedMs + FREEZE_AFTER_MS);
  return social.cumulative(object, metric, at);
}

function videoResource(
  social: SocialState,
  object: SocialObject,
  fields: readonly string[],
  self: string,
) {
  const account = object.accountId
    ? social.account('tiktok', object.accountId)
    : undefined;
  const handle = account?.handle ?? 'creator';
  const all: Record<string, unknown> = {
    id: object.id,
    create_time: Math.floor(object.publishedMs / 1000),
    cover_image_url: mediaUrl(self, 'thumbnail', object.id, object.title),
    share_url: `https://www.tiktok.com/@${handle}/video/${object.id}`,
    video_description: object.caption,
    duration: object.durationSeconds,
    height: 1024,
    width: 576,
    title: object.caption,
    embed_html: `<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@${handle}/video/${object.id}" data-video-id="${object.id}"></blockquote>`,
    embed_link: `https://www.tiktok.com/embed/v2/${object.id}`,
    like_count: reported(social, object, 'likes'),
    comment_count: reported(social, object, 'comments'),
    share_count: reported(social, object, 'shares'),
    view_count: reported(social, object, 'views'),
    is_aigc: false,
  };
  return Object.fromEntries(fields.map((f) => [f, all[f]]));
}

/** POST /v2/video/query/ */
const videoQuery: SocialRoute = ({
  url,
  method,
  req,
  res,
  body,
  social,
  self,
  about,
}) => {
  if (method !== 'POST' || url.pathname !== '/v2/video/query/') return false;
  const token = authorize(req, res, social, [SCOPE.list]);
  if (!token) return true;

  const refuse = (message: string) => {
    sendJson(res, 400, tiktokError(social, 'invalid_params', message));
    return true;
  };
  const fields = fieldList(url);
  const unsupported = fields.filter(
    (f) => !(DISPLAY_VIDEO_FIELDS as readonly string[]).includes(f),
  );
  if (fields.length === 0) return refuse('The fields parameter is required.');
  if (unsupported.length > 0)
    return refuse(`Invalid fields: ${unsupported.join(',')}`);

  const ids = objectAt(jsonBody(body).filters).video_ids;
  if (!Array.isArray(ids) || ids.length === 0)
    return refuse('filters.video_ids is required.');
  if (ids.length > MAX_QUERY_IDS)
    return refuse(
      `filters.video_ids has ${ids.length} ids; the maximum is ${MAX_QUERY_IDS}.`,
    );
  if (ids.length === 1) about(String(ids[0]));

  const videos = ids
    .map((id) => social.object('tiktok', String(id)))
    .filter((o) => o.accountId === null || o.accountId === token.accountId)
    .map((o) => videoResource(social, o, fields, self));
  sendJson(res, 200, ok(social, { videos }));
  return true;
};

function publishId(
  social: SocialState,
  kind: Publish['kind'],
  source: Publish['source'],
) {
  const digits = [...social.recordId('tiktok-publish', 19)]
    .map((c) => c.charCodeAt(0) % 10)
    .join('');
  const prefix =
    kind === 'inbox'
      ? 'v_inbox_file'
      : source === 'FILE_UPLOAD'
        ? 'v_pub_file'
        : 'v_pub_url';
  return `${prefix}~v2.7${digits}`;
}

function initPublish(kind: Publish['kind']): SocialRoute {
  const path =
    kind === 'inbox'
      ? '/v2/post/publish/inbox/video/init/'
      : '/v2/post/publish/video/init/';
  const scope = kind === 'inbox' ? SCOPE.upload : SCOPE.publish;

  return ({ url, method, req, res, body, social, self, about }) => {
    if (method !== 'POST' || url.pathname !== path) return false;
    const token = authorize(req, res, social, [scope]);
    if (!token) return true;

    const refuse = (message: string) => {
      sendJson(res, 400, tiktokError(social, 'invalid_params', message));
      return true;
    };
    const request = jsonBody(body);
    const source = objectAt(request.source_info);
    const post = objectAt(request.post_info);

    if (kind === 'direct') {
      if (!PRIVACY_LEVELS.includes(String(post.privacy_level ?? '')))
        return refuse(
          'post_info.privacy_level must be one of the options the creator offers.',
        );
      if (String(post.title ?? '').length > 2200)
        return refuse('post_info.title is longer than 2200 characters.');
    }

    const sourceType = source.source;
    if (sourceType !== 'FILE_UPLOAD' && sourceType !== 'PULL_FROM_URL')
      return refuse('source_info.source must be FILE_UPLOAD or PULL_FROM_URL.');

    let videoSize = 0;
    if (sourceType === 'FILE_UPLOAD') {
      videoSize = Number(source.video_size);
      const chunk = Number(source.chunk_size);
      const count = Number(source.total_chunk_count);
      if (
        !Number.isInteger(videoSize) ||
        videoSize <= 0 ||
        !Number.isInteger(chunk) ||
        chunk <= 0 ||
        !Number.isInteger(count) ||
        count <= 0
      )
        return refuse(
          'source_info.video_size, chunk_size and total_chunk_count are required for FILE_UPLOAD.',
        );
    } else if (!/^https?:\/\//.test(String(source.video_url ?? ''))) {
      return refuse('source_info.video_url is required for PULL_FROM_URL.');
    }

    const record = social.add<Publish>(PUBLISHES, {
      id: publishId(social, kind, sourceType),
      kind,
      source: sourceType,
      accountId: token.accountId,
      videoSize,
      uploadedBytes: 0,
      uploadToken: social.recordId('tiktok-upload', 24),
      createdMs: social.now(),
      title: String(post.title ?? ''),
    });
    about(record.id);
    sendJson(
      res,
      200,
      ok(
        social,
        sourceType === 'FILE_UPLOAD'
          ? {
              publish_id: record.id,
              upload_url: `${self}/video/?upload_id=${encodeURIComponent(record.id)}&upload_token=${record.uploadToken}`,
            }
          : { publish_id: record.id },
      ),
    );
    return true;
  };
}

/** PUT {upload_url} — one chunk, with its Content-Range. */
const uploadChunk: SocialRoute = ({
  url,
  method,
  req,
  res,
  body,
  social,
  about,
}) => {
  if (method !== 'PUT' || url.pathname !== '/video/') return false;

  const record = publishes(social).find(
    (p) =>
      p.id === url.searchParams.get('upload_id') &&
      p.uploadToken === url.searchParams.get('upload_token'),
  );
  if (!record) {
    sendJson(
      res,
      404,
      tiktokError(social, 'invalid_params', 'The upload URL is not valid.'),
    );
    return true;
  }
  about(record.id);

  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
    String(req.headers['content-range'] ?? ''),
  );
  if (!range) {
    sendJson(
      res,
      400,
      tiktokError(social, 'invalid_params', 'Content-Range is required.'),
    );
    return true;
  }
  const [start, end, total] = [
    Number(range[1]),
    Number(range[2]),
    Number(range[3]),
  ];
  if (total !== record.videoSize || end - start + 1 !== body.length) {
    sendJson(
      res,
      400,
      tiktokError(
        social,
        'invalid_params',
        'Content-Range does not match the declared video size or the chunk.',
      ),
    );
    return true;
  }
  if (start !== record.uploadedBytes) {
    sendJson(
      res,
      416,
      tiktokError(
        social,
        'invalid_params',
        'The chunk does not continue where the last one ended.',
      ),
    );
    return true;
  }

  record.uploadedBytes = end + 1;
  const complete = record.uploadedBytes === record.videoSize;
  if (complete) record.uploadedMs ??= social.now();
  res.writeHead(complete ? 201 : 206, {
    'content-range': `bytes ${start}-${end}/${total}`,
    'content-length': 0,
  });
  res.end();
  return true;
};

function statusOf(record: Publish, nowMs: number) {
  const since =
    record.source === 'FILE_UPLOAD' ? record.uploadedMs : record.createdMs;
  if (since === undefined) return 'PROCESSING_UPLOAD';
  const ready = nowMs - since >= PROCESSING_MS;
  if (record.kind === 'inbox') {
    return record.source === 'PULL_FROM_URL' && !ready
      ? 'PROCESSING_DOWNLOAD'
      : 'SEND_TO_USER_INBOX';
  }
  if (ready) return 'PUBLISH_COMPLETE';
  return record.source === 'PULL_FROM_URL'
    ? 'PROCESSING_DOWNLOAD'
    : 'PROCESSING_UPLOAD';
}

/** POST /v2/post/publish/status/fetch/ */
const publishStatus: SocialRoute = ({
  url,
  method,
  req,
  res,
  body,
  social,
  about,
}) => {
  if (method !== 'POST' || url.pathname !== '/v2/post/publish/status/fetch/')
    return false;
  const token = authorize(req, res, social, [SCOPE.publish, SCOPE.upload]);
  if (!token) return true;

  const id = String(jsonBody(body).publish_id ?? '');
  const record = publishes(social).find(
    (p) => p.id === id && p.accountId === token.accountId,
  );
  if (!record) {
    sendJson(
      res,
      400,
      tiktokError(
        social,
        'invalid_publish_id',
        'The publish_id is invalid or does not belong to this user.',
      ),
    );
    return true;
  }
  about(id);

  const status = statusOf(record, social.now());
  if (status === 'PUBLISH_COMPLETE' && !record.postId) {
    const object = social.createObject('tiktok', token.accountId, {
      title: record.title,
      caption: record.title,
    });
    record.postId = object.id;
  }
  sendJson(
    res,
    200,
    ok(social, {
      status,
      ...(record.source === 'FILE_UPLOAD'
        ? { uploaded_bytes: record.uploadedBytes }
        : {}),
      ...(record.postId
        ? { publicaly_available_post_id: [record.postId] }
        : {}),
    }),
  );
  return true;
};

export const tiktokDataRoutes = [
  userInfo,
  videoQuery,
  initPublish('inbox'),
  initPublish('direct'),
  uploadChunk,
  publishStatus,
];
