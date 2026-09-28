import { sendJson } from '../../../http';
import { mediaUrl } from '../../media';
import type { SocialRequest, SocialRoute } from '../../server';
import type { SocialAccount, SocialObject, SocialState } from '../../state';
import {
  MANAGE_SCOPES,
  READ_SCOPES,
  UPLOAD_SCOPES,
  authorize,
  googleError,
} from './errors';

/** Tombstones of deleted videos, kept in the state's records. */
const DELETED = 'deleted:youtube';

/**
 * YouTube Data API v3, the calls the app makes
 * (https://developers.google.com/youtube/v3/docs): channels.list (connect,
 * the subscriber snapshot), videos.list (video info, durations),
 * videos.insert (a multipart upload — googleapis never sends a resumable
 * one here), videos.delete (unpublish), thumbnails.set and
 * playlistItems.insert.
 */

const DAY_MS = 86_400_000;

type Json = Record<string, unknown>;

/** A JSON object field, or an empty object when it is missing or not one. */
function objectAt(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

/** `part=snippet,statistics` or `part=snippet&part=statistics`. */
function listParam(url: URL, name: string) {
  return url.searchParams
    .getAll(name)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function etag(social: SocialState, key: string) {
  return social.rngFor(`etag:${key}`).next().toString(36).slice(2, 29);
}

/** Rounded down to three significant figures, as the Data API documents. */
export function threeSignificantFigures(count: number) {
  if (count < 1000) return count;
  const scale = 10 ** (Math.floor(Math.log10(count)) - 2);
  return Math.floor(count / scale) * scale;
}

function thumbnails(
  self: string,
  kind: string,
  id: string,
  label: string,
  sizes: Record<string, [number, number]>,
) {
  return Object.fromEntries(
    Object.entries(sizes).map(([name, [width, height]]) => [
      name,
      { url: mediaUrl(self, kind, `${id}-${name}`, label), width, height },
    ]),
  );
}

function channelCreated(social: SocialState, account: SocialAccount) {
  const rng = social.rngFor(`channel-created:${account.id}`);
  return new Date(social.now() - rng.int(200, 2400) * DAY_MS).toISOString();
}

function channelResource(
  ctx: SocialRequest,
  account: SocialAccount,
  parts: string[],
) {
  const { social, self } = ctx;
  const objects = social
    .listObjects('youtube')
    .filter((o) => o.accountId === account.id);
  const baseViews = social
    .rngFor(`channel-views:${account.id}`)
    .int(4_000, 900_000);
  const resource: Record<string, unknown> = {
    kind: 'youtube#channel',
    etag: etag(social, `channel:${account.id}`),
    id: account.id,
  };

  if (parts.includes('snippet')) {
    resource.snippet = {
      title: account.name,
      description: account.bio,
      customUrl: `@${account.handle.replace(/[._]/g, '')}`,
      publishedAt: channelCreated(social, account),
      thumbnails: thumbnails(self, 'avatar', account.id, account.name, {
        default: [88, 88],
        medium: [240, 240],
        high: [800, 800],
      }),
    };
  }
  if (parts.includes('statistics')) {
    const views = objects.reduce(
      (sum, o) => sum + social.cumulative(o, 'views'),
      baseViews,
    );
    resource.statistics = {
      viewCount: String(views),
      subscriberCount: String(
        threeSignificantFigures(social.followers(account)),
      ),
      hiddenSubscriberCount: false,
      videoCount: String(
        objects.length +
          social.rngFor(`channel-videos:${account.id}`).int(3, 60),
      ),
    };
  }
  return resource;
}

function isoDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `PT${m ? `${m}M` : ''}${s || !m ? `${s}S` : ''}`;
}

function videoResource(
  ctx: SocialRequest,
  object: SocialObject,
  parts: string[],
) {
  const { social, self } = ctx;
  const channel = object.accountId
    ? social.account('youtube', object.accountId)
    : undefined;
  const d = object.details ?? {};
  const resource: Record<string, unknown> = {
    kind: 'youtube#video',
    etag: etag(social, `video:${object.id}`),
    id: object.id,
  };

  if (parts.includes('snippet')) {
    resource.snippet = {
      publishedAt: new Date(object.publishedMs).toISOString(),
      channelId: object.accountId ?? channel?.id ?? '',
      title: object.title,
      description: object.caption,
      thumbnails: thumbnails(self, 'thumbnail', object.id, object.title, {
        default: [120, 90],
        medium: [320, 180],
        high: [480, 360],
      }),
      channelTitle: channel?.name ?? '',
      ...(Array.isArray(d.tags) ? { tags: d.tags } : {}),
      categoryId: typeof d.categoryId === 'string' ? d.categoryId : '24',
    };
  }
  if (parts.includes('contentDetails')) {
    resource.contentDetails = {
      duration: isoDuration(object.durationSeconds),
      dimension: '2d',
      definition: 'hd',
      caption: 'false',
    };
  }
  if (parts.includes('status')) {
    resource.status = {
      uploadStatus: 'processed',
      privacyStatus:
        typeof d.privacyStatus === 'string' ? d.privacyStatus : 'public',
      madeForKids: d.madeForKids === true,
      selfDeclaredMadeForKids: d.madeForKids === true,
    };
  }
  if (parts.includes('statistics')) {
    resource.statistics = {
      viewCount: String(social.cumulative(object, 'views')),
      likeCount: String(social.cumulative(object, 'likes')),
      dislikeCount: String(
        Math.floor(social.cumulative(object, 'likes') * 0.035),
      ),
      favoriteCount: '0',
      commentCount: String(social.cumulative(object, 'comments')),
    };
  }
  return resource;
}

function listEnvelope(social: SocialState, kind: string, items: unknown[]) {
  return {
    kind,
    etag: etag(social, `${kind}:${items.length}`),
    pageInfo: { totalResults: items.length, resultsPerPage: items.length },
    items,
  };
}

/** GET /youtube/v3/channels */
const channelsList: SocialRoute = (ctx) => {
  const { url, method, req, res, social } = ctx;
  if (method !== 'GET' || url.pathname !== '/youtube/v3/channels') return false;

  const token = authorize(req, res, social, READ_SCOPES);
  if (!token) return true;

  const parts = listParam(url, 'part');
  const ids = listParam(url, 'id');
  const mine = url.searchParams.get('mine') === 'true';

  const accounts = mine
    ? [social.account('youtube', token.accountId)].filter(
        (a): a is SocialAccount => !!a,
      )
    : ids
        .map((id) => social.account('youtube', id))
        .filter((a): a is SocialAccount => !!a);

  sendJson(
    res,
    200,
    listEnvelope(
      social,
      'youtube#channelListResponse',
      accounts.map((a) => channelResource(ctx, a, parts)),
    ),
  );
  return true;
};

/** GET /youtube/v3/videos */
const videosList: SocialRoute = (ctx) => {
  const { url, method, req, res, social, about } = ctx;
  if (method !== 'GET' || url.pathname !== '/youtube/v3/videos') return false;

  if (!authorize(req, res, social, READ_SCOPES)) return true;

  const parts = listParam(url, 'part');
  // A deleted video is simply absent from the list, as YouTube answers.
  const deleted = social.list(DELETED);
  const ids = listParam(url, 'id').filter((id) => !deleted.includes(id));
  if (ids.length === 1) about(ids[0]!);

  sendJson(
    res,
    200,
    listEnvelope(
      social,
      'youtube#videoListResponse',
      ids.map((id) => videoResource(ctx, social.object('youtube', id), parts)),
    ),
  );
  return true;
};

/** The JSON part and the media part of a `multipart/related` body. */
export function multipartRelated(contentType: string, body: Buffer) {
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (!boundary) return null;

  const text = body.toString('latin1');
  const parts = text
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((part) => {
      const split = part.indexOf('\r\n\r\n');
      const head = part.slice(0, split);
      const content = part.slice(split + 4).replace(/\r\n$/, '');
      return {
        contentType:
          /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim() ?? '',
        content,
      };
    });

  const json = parts.find((p) => p.contentType.startsWith('application/json'));
  const media = parts.find(
    (p) => !p.contentType.startsWith('application/json'),
  );
  if (!json) return null;

  return {
    resource: objectAt(
      JSON.parse(Buffer.from(json.content, 'latin1').toString('utf8')),
    ),
    mediaBytes: media ? Buffer.byteLength(media.content, 'latin1') : 0,
  };
}

/** POST /upload/youtube/v3/videos?uploadType=multipart */
const videosInsert: SocialRoute = (ctx) => {
  const { url, method, req, res, body, social, about } = ctx;
  if (method !== 'POST' || url.pathname !== '/upload/youtube/v3/videos')
    return false;

  const token = authorize(req, res, social, UPLOAD_SCOPES);
  if (!token) return true;

  const parsed = multipartRelated(req.headers['content-type'] ?? '', body);
  if (
    url.searchParams.get('uploadType') !== 'multipart' ||
    !parsed ||
    parsed.mediaBytes === 0
  ) {
    sendJson(
      res,
      400,
      googleError(
        400,
        'The request does not include the video content.',
        'mediaBodyRequired',
        'INVALID_ARGUMENT',
      ),
    );
    return true;
  }

  const snippet = objectAt(parsed.resource.snippet);
  const status = objectAt(parsed.resource.status);
  const title = String(snippet.title ?? '');
  if (!title.trim()) {
    sendJson(
      res,
      400,
      googleError(
        400,
        'The request metadata does not specify a video title.',
        'invalidTitle',
        'INVALID_ARGUMENT',
      ),
    );
    return true;
  }
  const isShort = /#shorts\b/i.test(`${title} ${snippet.description ?? ''}`);
  const rng = social.rngFor(`upload-duration:${title}`);

  const object = social.createObject('youtube', token.accountId, {
    title,
    caption: String(snippet.description ?? ''),
    durationSeconds: isShort ? rng.int(14, 59) : rng.int(64, 178),
    details: {
      privacyStatus: String(status.privacyStatus ?? 'public'),
      madeForKids:
        status.selfDeclaredMadeForKids === true || status.madeForKids === true,
      categoryId: String(snippet.categoryId ?? '24'),
      ...(Array.isArray(snippet.tags)
        ? { tags: snippet.tags.map(String) }
        : {}),
      creatorContentType: isShort ? 'SHORTS' : 'VIDEO_ON_DEMAND',
    },
  });
  about(object.id);

  const resource = videoResource(ctx, object, listParam(url, 'part'));
  // Just uploaded: not processed yet.
  if (resource.status)
    (resource.status as Record<string, unknown>).uploadStatus = 'uploaded';
  sendJson(res, 200, resource);
  return true;
};

/** POST /upload/youtube/v3/thumbnails/set?videoId=…&uploadType=media */
const thumbnailsSet: SocialRoute = (ctx) => {
  const { url, method, req, res, body, social, self, about } = ctx;
  if (method !== 'POST' || url.pathname !== '/upload/youtube/v3/thumbnails/set')
    return false;

  const token = authorize(req, res, social, UPLOAD_SCOPES);
  if (!token) return true;

  const videoId = url.searchParams.get('videoId') ?? '';
  about(videoId);
  if (body.length === 0) {
    sendJson(
      res,
      400,
      googleError(
        400,
        'The request does not include the image content.',
        'mediaBodyRequired',
        'INVALID_ARGUMENT',
      ),
    );
    return true;
  }
  if (
    !social.hasObject('youtube', videoId) ||
    social.object('youtube', videoId).accountId !== token.accountId
  ) {
    sendJson(
      res,
      404,
      googleError(
        404,
        'The video that you are trying to update cannot be found.',
        'videoNotFound',
        'NOT_FOUND',
      ),
    );
    return true;
  }

  const object = social.object('youtube', videoId);
  sendJson(res, 200, {
    kind: 'youtube#thumbnailSetResponse',
    etag: etag(social, `thumb:${videoId}`),
    items: [
      thumbnails(self, 'thumbnail', `${videoId}-custom`, object.title, {
        default: [120, 90],
        medium: [320, 180],
        high: [480, 360],
      }),
    ],
  });
  return true;
};

/** POST /youtube/v3/playlistItems?part=snippet */
const playlistItemsInsert: SocialRoute = (ctx) => {
  const { url, method, req, res, body, social, about } = ctx;
  if (method !== 'POST' || url.pathname !== '/youtube/v3/playlistItems')
    return false;

  if (!authorize(req, res, social, MANAGE_SCOPES)) return true;

  const snippet = objectAt(
    objectAt(JSON.parse(body.toString('utf8') || '{}')).snippet,
  );
  const playlistId = String(snippet.playlistId ?? '');
  const videoId = String(objectAt(snippet.resourceId).videoId ?? '');
  about(videoId);
  if (!playlistId || !social.hasObject('youtube', videoId)) {
    sendJson(
      res,
      404,
      googleError(
        404,
        "The playlist identified with the request's playlistId parameter cannot be found.",
        'playlistNotFound',
        'NOT_FOUND',
      ),
    );
    return true;
  }

  const object = social.object('youtube', videoId);
  sendJson(res, 200, {
    kind: 'youtube#playlistItem',
    etag: etag(social, `pli:${playlistId}:${videoId}`),
    id: social.recordId('playlist-item', 34),
    snippet: {
      playlistId,
      title: object.title,
      position: social.list(`playlist:${playlistId}`).length,
      resourceId: { kind: 'youtube#video', videoId },
    },
  });
  social.add(`playlist:${playlistId}`, videoId);
  return true;
};

/**
 * DELETE /youtube/v3/videos?id=… — 204 with no body. An unknown or already
 * deleted video is 404 videoNotFound; another channel's video is refused the
 * same way, as YouTube does not say it exists. An adopted video (one the app
 * already held, owner unknown) may be deleted by any authorised token.
 */
const videosDelete: SocialRoute = (ctx) => {
  const { url, method, req, res, social, about } = ctx;
  if (method !== 'DELETE' || url.pathname !== '/youtube/v3/videos')
    return false;

  const token = authorize(req, res, social, MANAGE_SCOPES);
  if (!token) return true;

  const videoId = url.searchParams.get('id') ?? '';
  about(videoId);
  const owner = social.hasObject('youtube', videoId)
    ? social.object('youtube', videoId).accountId
    : undefined;
  if (
    owner === undefined ||
    (owner !== null && owner !== token.accountId) ||
    social.list(DELETED).includes(videoId)
  ) {
    sendJson(
      res,
      404,
      googleError(
        404,
        'The video that you are trying to delete cannot be found.',
        'videoNotFound',
        'NOT_FOUND',
      ),
    );
    return true;
  }

  social.removeObject('youtube', videoId);
  social.add(DELETED, videoId);
  res.writeHead(204);
  res.end();
  return true;
};

export const youtubeDataRoutes = [
  channelsList,
  videosList,
  videosInsert,
  videosDelete,
  thumbnailsSet,
  playlistItemsInsert,
];
