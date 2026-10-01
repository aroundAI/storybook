import { sendJson } from '../../../http';
import { mediaUrl } from '../../media';
import type { SocialRequest, SocialRoute } from '../../server';
import type { SocialObject, SocialState } from '../../state';
import {
  CLIENT_NOT_ENROLLED,
  SCOPE,
  authorize,
  invalidRequest,
  notFound,
  xProblem,
} from './errors';
import { xUsername } from './oauth';

/**
 * X API v2, the calls the app makes (https://docs.x.com/x-api): users/me
 * (connect), the chunked media upload (initialize, append, finalize, STATUS),
 * create and delete a post — and the posts lookup with its metric fields,
 * which the app does not call yet (FILM-1727) but whose gates are §3's X row:
 * non-public and organic metrics only for posts under 30 days old, gated on
 * the post's creation date, and the Enterprise-only analytics endpoints
 * answering with the tier error.
 */

const DELETED = 'deleted:x';
const MEDIA = 'x-media';
const DAY_MS = 86_400_000;

/** Non-public and organic metrics exist for 30 days after creation. */
export const NON_PUBLIC_WINDOW_MS = 30 * DAY_MS;
/** Real time X takes to process an uploaded video, as the social clock reads it. */
export const MEDIA_PROCESSING_MS = 3_000;
const MEDIA_SESSION_SECONDS = 86_400;
/**
 * `total_bytes`: "type: integer, minimum: 0, maximum: 17179869184"
 * (https://docs.x.com/x-api/media/media-upload-initialize, read 2026-10-01).
 * It was 512 MB here, a figure the reference does not give.
 */
export const MAX_TOTAL_BYTES = 17_179_869_184;

interface MediaUpload {
  id: string;
  mediaKey: string;
  accountId: string;
  mediaType: string;
  category: string;
  totalBytes: number;
  receivedBytes: number;
  segments: number[];
  createdMs: number;
  finalizedMs?: number;
}

type Json = Record<string, unknown>;

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

/** The text fields and the byte length of the `media` part of a multipart form. */
export function multipartForm(contentType: string, body: Buffer) {
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  const fields: Record<string, string> = {};
  let mediaBytes = 0;
  if (!boundary) return { fields, mediaBytes };

  const text = body.toString('latin1');
  for (const part of text.split(`--${boundary}`).slice(1, -1)) {
    const split = part.indexOf('\r\n\r\n');
    const head = part.slice(0, split);
    const content = part.slice(split + 4).replace(/\r\n$/, '');
    const name = /name="([^"]+)"/i.exec(head)?.[1];
    if (name === 'media') mediaBytes = Buffer.byteLength(content, 'latin1');
    else if (name) fields[name] = content;
  }
  return { fields, mediaBytes };
}

function uploads(social: SocialState) {
  return social.list<MediaUpload>(MEDIA);
}

/** Digits, as X's snowflake ids are. */
function digitsId(social: SocialState, namespace: string) {
  const raw = social.recordId(namespace, 18);
  return `1${[...raw].map((c) => c.charCodeAt(0) % 10).join('')}`;
}

function processing(upload: MediaUpload, nowMs: number) {
  const elapsed = nowMs - (upload.finalizedMs ?? nowMs);
  if (elapsed >= MEDIA_PROCESSING_MS) {
    return { state: 'succeeded', progress_percent: 100 };
  }
  return elapsed < MEDIA_PROCESSING_MS / 2
    ? { state: 'pending', check_after_secs: 1 }
    : {
        state: 'in_progress',
        progress_percent: Math.floor((elapsed / MEDIA_PROCESSING_MS) * 100),
        check_after_secs: 1,
      };
}

function mediaData(upload: MediaUpload, nowMs: number, withSize: boolean) {
  const info = upload.finalizedMs ? processing(upload, nowMs) : undefined;
  return {
    id: upload.id,
    media_key: upload.mediaKey,
    ...(withSize ? { size: upload.totalBytes } : {}),
    expires_after_secs: MEDIA_SESSION_SECONDS,
    ...(upload.mediaType.startsWith('video/')
      ? { video: { video_type: upload.mediaType } }
      : {}),
    ...(info ? { processing_info: info } : {}),
  };
}

/** POST /2/media/upload/initialize */
const mediaInitialize: SocialRoute = ({
  url,
  method,
  req,
  res,
  body,
  social,
}) => {
  if (method !== 'POST' || url.pathname !== '/2/media/upload/initialize')
    return false;
  const token = authorize(req, res, social, [SCOPE.media]);
  if (!token) return true;

  const params = jsonBody(body);
  const mediaType =
    typeof params.media_type === 'string' ? params.media_type : '';
  const totalBytes = Number(params.total_bytes);
  if (
    !mediaType ||
    !Number.isInteger(totalBytes) ||
    totalBytes < 0 ||
    totalBytes > MAX_TOTAL_BYTES
  ) {
    // The page names no field-level message for this; the problem type is
    // its InvalidRequestProblem, and the wording is ours.
    sendJson(
      res,
      400,
      invalidRequest(
        `media_type and a total_bytes between 0 and ${MAX_TOTAL_BYTES} are required`,
      ),
    );
    return true;
  }

  const id = digitsId(social, 'x-media');
  const upload = social.add<MediaUpload>(MEDIA, {
    id,
    mediaKey: `7_${id}`,
    accountId: token.accountId,
    mediaType,
    category:
      typeof params.media_category === 'string' ? params.media_category : '',
    totalBytes,
    receivedBytes: 0,
    segments: [],
    createdMs: social.now(),
  });
  sendJson(res, 200, {
    data: {
      id: upload.id,
      media_key: upload.mediaKey,
      expires_after_secs: MEDIA_SESSION_SECONDS,
    },
  });
  return true;
};

function uploadOf(
  ctx: SocialRequest,
  id: string,
  accountId: string,
): MediaUpload | null {
  const found = uploads(ctx.social).find(
    (u) => u.id === id && u.accountId === accountId,
  );
  if (!found) {
    sendJson(ctx.res, 404, {
      ...notFound(id).errors[0],
      resource_type: 'media',
      detail: `Could not find media with id: [${id}].`,
    });
    return null;
  }
  return found;
}

/** POST /2/media/upload/{id}/append */
const mediaAppend: SocialRoute = (ctx) => {
  const { url, method, req, res, body, social } = ctx;
  const match = /^\/2\/media\/upload\/(\d+)\/append$/.exec(url.pathname);
  if (method !== 'POST' || !match) return false;
  const token = authorize(req, res, social, [SCOPE.media]);
  if (!token) return true;

  const upload = uploadOf(ctx, match[1]!, token.accountId);
  if (!upload) return true;

  const form = multipartForm(req.headers['content-type'] ?? '', body);
  const segment = Number(form.fields.segment_index);
  if (!Number.isInteger(segment) || segment < 0 || form.mediaBytes === 0) {
    sendJson(
      res,
      400,
      invalidRequest('segment_index and a media part are required'),
    );
    return true;
  }
  if (upload.finalizedMs) {
    sendJson(res, 400, invalidRequest('The upload has already been finalized'));
    return true;
  }
  if (!upload.segments.includes(segment)) {
    upload.segments.push(segment);
    upload.receivedBytes += form.mediaBytes;
  }
  sendJson(res, 200, {
    data: {
      expires_at: Math.floor(upload.createdMs / 1000) + MEDIA_SESSION_SECONDS,
    },
  });
  return true;
};

/** POST /2/media/upload/{id}/finalize */
const mediaFinalize: SocialRoute = (ctx) => {
  const { url, method, req, res, social } = ctx;
  const match = /^\/2\/media\/upload\/(\d+)\/finalize$/.exec(url.pathname);
  if (method !== 'POST' || !match) return false;
  const token = authorize(req, res, social, [SCOPE.media]);
  if (!token) return true;

  const upload = uploadOf(ctx, match[1]!, token.accountId);
  if (!upload) return true;

  if (upload.receivedBytes !== upload.totalBytes) {
    sendJson(
      res,
      400,
      invalidRequest(
        `The uploaded size (${upload.receivedBytes}) does not match total_bytes (${upload.totalBytes})`,
      ),
    );
    return true;
  }
  upload.finalizedMs ??= social.now();
  sendJson(res, 200, { data: mediaData(upload, social.now(), true) });
  return true;
};

/** GET /2/media/upload?command=STATUS&media_id=… */
const mediaStatus: SocialRoute = (ctx) => {
  const { url, method, req, res, social } = ctx;
  if (method !== 'GET' || url.pathname !== '/2/media/upload') return false;
  const token = authorize(req, res, social, [SCOPE.media]);
  if (!token) return true;

  if (url.searchParams.get('command') !== 'STATUS') {
    sendJson(res, 400, invalidRequest('command must be STATUS'));
    return true;
  }
  const upload = uploadOf(
    ctx,
    url.searchParams.get('media_id') ?? '',
    token.accountId,
  );
  if (!upload) return true;
  sendJson(res, 200, { data: mediaData(upload, social.now(), false) });
  return true;
};

const tweetText = (object: SocialObject) => object.caption;

function tweetOwner(social: SocialState, object: SocialObject) {
  return object.accountId ? social.account('x', object.accountId) : undefined;
}

/** POST /2/tweets */
const createTweet: SocialRoute = ({
  url,
  method,
  req,
  res,
  body,
  social,
  about,
}) => {
  if (method !== 'POST' || url.pathname !== '/2/tweets') return false;
  const token = authorize(req, res, social, [
    SCOPE.read,
    SCOPE.write,
    SCOPE.users,
  ]);
  if (!token) return true;

  const params = jsonBody(body);
  const text = typeof params.text === 'string' ? params.text : '';
  const mediaIds = objectAt(params.media).media_ids;
  const ids = Array.isArray(mediaIds) ? mediaIds.map(String) : [];

  if (!text.trim() && ids.length === 0) {
    sendJson(res, 400, invalidRequest('A post needs text or media'));
    return true;
  }
  // FILM-1731: "made_with_ai boolean" (Create Post, read 2026-10-02); a
  // value of another type is refused.
  if (
    params.made_with_ai !== undefined &&
    typeof params.made_with_ai !== 'boolean'
  ) {
    sendJson(res, 400, invalidRequest('made_with_ai must be a boolean'));
    return true;
  }
  for (const id of ids) {
    const upload = uploads(social).find(
      (u) => u.id === id && u.accountId === token.accountId,
    );
    const ready =
      upload?.finalizedMs !== undefined &&
      processing(upload, social.now()).state === 'succeeded';
    if (!ready) {
      sendJson(
        res,
        400,
        invalidRequest(`Media id ${id} is not ready to attach`),
      );
      return true;
    }
  }
  const duplicate = social
    .listObjects('x')
    .some((o) => o.accountId === token.accountId && tweetText(o) === text);
  if (duplicate) {
    sendJson(
      res,
      403,
      xProblem(
        403,
        'Forbidden',
        'You are not allowed to create a Tweet with duplicate content.',
      ),
    );
    return true;
  }

  const object = social.createObject('x', token.accountId, {
    title: text.split('\n')[0]!.slice(0, 100) || text,
    caption: text,
    details: {
      ...(ids.length > 0 ? { mediaIds: ids } : {}),
      ...(typeof params.reply_settings === 'string'
        ? { replySettings: params.reply_settings }
        : {}),
      ...(params.made_with_ai === true ? { madeWithAi: true } : {}),
    },
  });
  about(object.id);
  sendJson(res, 201, {
    data: {
      id: object.id,
      text,
      edit_history_post_ids: [object.id],
    },
  });
  return true;
};

/** DELETE /2/tweets/{id} */
const deleteTweet: SocialRoute = ({ url, method, req, res, social, about }) => {
  const match = /^\/2\/tweets\/(\d+)$/.exec(url.pathname);
  if (method !== 'DELETE' || !match) return false;
  const token = authorize(req, res, social, [
    SCOPE.read,
    SCOPE.write,
    SCOPE.users,
  ]);
  if (!token) return true;

  const id = match[1]!;
  about(id);
  const object = social.hasObject('x', id) ? social.object('x', id) : null;
  if (!object || object.accountId !== token.accountId) {
    sendJson(res, 200, { data: { deleted: false } });
    return true;
  }
  social.removeObject('x', id);
  social.add(DELETED, id);
  sendJson(res, 200, { data: { deleted: true } });
  return true;
};

function postMetrics(social: SocialState, object: SocialObject) {
  const views = social.cumulative(object, 'views');
  const likes = social.cumulative(object, 'likes');
  const comments = social.cumulative(object, 'comments');
  const shares = social.cumulative(object, 'shares');
  const impressions = views * 3;
  return {
    public: {
      retweet_count: shares,
      reply_count: comments,
      like_count: likes,
      quote_count: Math.floor(shares * 0.2),
      bookmark_count: social.cumulative(object, 'saves'),
      impression_count: impressions,
    },
    // The data dictionary lists `engagements` in non_public_metrics and does
    // not define it; the sum of the post's other interactions stands in.
    nonPublic: {
      impression_count: impressions,
      url_link_clicks: Math.floor(views * 0.004),
      user_profile_clicks: Math.floor(views * 0.006),
      engagements:
        likes +
        comments +
        shares +
        Math.floor(shares * 0.2) +
        Math.floor(views * 0.004) +
        Math.floor(views * 0.006),
    },
    organic: {
      impression_count: impressions,
      like_count: likes,
      reply_count: comments,
      retweet_count: shares,
      url_link_clicks: Math.floor(views * 0.004),
      user_profile_clicks: Math.floor(views * 0.006),
    },
  };
}

/** The media object's quartiles: each is a share of the views, falling as they go. */
function mediaMetrics(social: SocialState, object: SocialObject) {
  const views = social.cumulative(object, 'views');
  const c = object.profile.ratios.completion;
  const at = (share: number) => Math.floor(views * share);
  const quartiles = {
    playback_0_count: views,
    playback_25_count: at(c + (1 - c) * 0.45),
    playback_50_count: at(c + (1 - c) * 0.15),
    playback_75_count: at(c * 0.6),
    playback_100_count: at(c * 0.3),
  };
  return {
    public: { view_count: views },
    nonPublic: quartiles,
    organic: { ...quartiles, view_count: views },
  };
}

function fieldList(url: URL, name: string) {
  return (url.searchParams.get(name) ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
}

/** A post in the shape `tweet.fields` and the media expansion ask for. */
function tweetResource(
  ctx: SocialRequest,
  object: SocialObject,
  token: { accountId: string },
) {
  const { social, url, self } = ctx;
  const fields = fieldList(url, 'tweet.fields');
  const mediaFields = fieldList(url, 'media.fields');
  const expansions = fieldList(url, 'expansions');
  const own = object.accountId === token.accountId;
  const withinWindow =
    social.now() - object.publishedMs < NON_PUBLIC_WINDOW_MS && own;
  const metrics = postMetrics(social, object);
  const owner = tweetOwner(social, object);
  const mediaIds = Array.isArray(object.details?.mediaIds)
    ? object.details.mediaIds
    : [];

  const data: Json = {
    id: object.id,
    text: object.caption,
    edit_history_post_ids: [object.id],
  };
  if (fields.includes('created_at'))
    data.created_at = new Date(object.publishedMs).toISOString();
  if (fields.includes('author_id') && owner) data.author_id = owner.id;
  if (fields.includes('public_metrics')) data.public_metrics = metrics.public;
  if (fields.includes('non_public_metrics') && withinWindow)
    data.non_public_metrics = metrics.nonPublic;
  if (fields.includes('organic_metrics') && withinWindow)
    data.organic_metrics = metrics.organic;
  if (mediaIds.length > 0 && expansions.includes('attachments.media_keys')) {
    data.attachments = { media_keys: mediaIds.map((id) => `7_${id}`) };
  }

  const media =
    mediaIds.length > 0 && expansions.includes('attachments.media_keys')
      ? mediaIds.map((id) => {
          const m = mediaMetrics(social, object);
          const item: Json = {
            media_key: `7_${id}`,
            type: 'video',
            preview_image_url: mediaUrl(
              self,
              'thumbnail',
              String(id),
              object.title,
            ),
          };
          if (mediaFields.includes('public_metrics'))
            item.public_metrics = m.public;
          if (mediaFields.includes('non_public_metrics') && withinWindow)
            item.non_public_metrics = m.nonPublic;
          if (mediaFields.includes('organic_metrics') && withinWindow)
            item.organic_metrics = m.organic;
          return item;
        })
      : [];
  return { data, media };
}

/** GET /2/tweets/{id} and GET /2/tweets?ids=… */
const lookupTweets: SocialRoute = (ctx) => {
  const { url, method, req, res, social, about } = ctx;
  const single = /^\/2\/tweets\/(\d+)$/.exec(url.pathname);
  const batch = url.pathname === '/2/tweets';
  if (method !== 'GET' || (!single && !batch)) return false;

  const token = authorize(req, res, social, [SCOPE.read, SCOPE.users]);
  if (!token) return true;

  const ids = single
    ? [single[1]!]
    : (url.searchParams.get('ids') ?? '').split(',').filter(Boolean);
  if (ids.length === 0 || ids.length > 100) {
    sendJson(res, 400, invalidRequest('ids must hold between 1 and 100 ids'));
    return true;
  }
  if (ids.length === 1) about(ids[0]!);

  const deleted = social.list<string>(DELETED);
  const found = ids.filter((id) => !deleted.includes(id));
  const resources = found.map((id) =>
    tweetResource(ctx, social.object('x', id), token),
  );
  const errors = ids
    .filter((id) => deleted.includes(id))
    .flatMap((id) => notFound(id).errors);
  const media = resources.flatMap((r) => r.media);

  const result: Json = {};
  if (single) {
    if (resources[0]) result.data = resources[0].data;
  } else if (resources.length > 0) {
    result.data = resources.map((r) => r.data);
  }
  if (media.length > 0) result.includes = { media };
  if (errors.length > 0) result.errors = errors;
  sendJson(res, 200, result);
  return true;
};

/** GET /2/users/me */
const usersMe: SocialRoute = ({ url, method, req, res, social, self }) => {
  if (method !== 'GET' || url.pathname !== '/2/users/me') return false;
  const token = authorize(req, res, social, [SCOPE.users, SCOPE.read]);
  if (!token) return true;

  const account = social.account('x', token.accountId);
  if (!account) {
    sendJson(res, 401, xProblem(401, 'Unauthorized', 'Unauthorized'));
    return true;
  }
  const fields = fieldList(url, 'user.fields');
  sendJson(res, 200, {
    data: {
      id: account.id,
      name: account.name,
      username: xUsername(account.handle),
      ...(fields.includes('profile_image_url')
        ? {
            profile_image_url: mediaUrl(
              self,
              'avatar',
              account.id,
              account.name,
            ),
          }
        : {}),
    },
  });
  return true;
};

/**
 * GET /2/media/analytics and /2/tweets/analytics: Enterprise-only (inferred,
 * see the capability reference's ledger). An app not enrolled at that tier
 * is told so, whatever its token holds.
 */
const enterpriseAnalytics: SocialRoute = ({
  url,
  method,
  req,
  res,
  social,
}) => {
  if (
    method !== 'GET' ||
    (url.pathname !== '/2/media/analytics' &&
      url.pathname !== '/2/tweets/analytics')
  )
    return false;
  if (!authorize(req, res, social, [SCOPE.read])) return true;
  sendJson(res, 403, CLIENT_NOT_ENROLLED);
  return true;
};

export const xDataRoutes = [
  mediaInitialize,
  mediaAppend,
  mediaFinalize,
  mediaStatus,
  createTweet,
  deleteTweet,
  lookupTweets,
  usersMe,
  enterpriseAnalytics,
];
