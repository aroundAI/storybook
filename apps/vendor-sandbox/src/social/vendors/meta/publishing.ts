import { sendJson } from '../../../http';
import type { SocialRoute } from '../../server';
import type { SocialState } from '../../state';
import { graphError, graphPath, metaAuthorize } from './errors';

/**
 * Publishing, as the app's providers do it:
 *
 * Instagram Reels (`instagram-provider.ts`), documented in
 * `instagram/container-fields` and the media-publish reference:
 * 1. `POST /{ig-user-id}/media?media_type=REELS&video_url=…` — a container;
 * 2. `GET /{container-id}?fields=status_code,status` — IN_PROGRESS while
 *    Meta fetches and processes the video, then FINISHED; EXPIRED after 24
 *    hours unpublished;
 * 3. `POST /{ig-user-id}/media_publish` {creation_id} — the post's id;
 * 4. `GET /{ig-media-id}?fields=permalink` (served by the media node).
 *
 * Facebook Reels (`facebook-provider.ts`), the Reels publishing guide:
 * `POST /{page-id}/video_reels` upload_phase=start → video_id, upload_url;
 * `POST {upload_url}` with `Authorization: OAuth …` and `file_url`; then
 * upload_phase=finish, video_state=PUBLISHED; `GET /{video-id}?fields=status`.
 *
 * Observed, not documented (the owner's live Page, 2026-09-29): a Video's
 * `permalink_url` — a path relative to facebook.com, `/reel/{id}/`, not a URL
 * — and `DELETE /{video-id}`, answered `{ success: true }`. Neither is on the
 * Video reference or the Reels guide. Not served: the non-Reel
 * `/{page-id}/videos` upload.
 */

const PUBLISH_SCOPE = ['instagram_content_publish'];
const PAGE_SCOPE = ['pages_manage_posts'];

/** Real seconds Meta takes to fetch and process a Reel, here. */
export const PROCESSING_MS = 20_000;
const EXPIRY_MS = 24 * 3_600_000;

interface Container {
  id: string;
  igId: string;
  createdMs: number;
  videoUrl: string;
  caption: string;
  publishedAs?: string;
  /** `is_ai_generated=true` on the container request (FILM-1731) */
  aiGenerated?: boolean;
}

interface FacebookReel {
  id: string;
  pageId: string;
  createdMs: number;
  uploaded: boolean;
  published: boolean;
  description: string;
  deleted?: boolean;
}

/** Digits, as Meta's ids are: a record id with its characters folded. */
function digitsId(social: SocialState, namespace: string) {
  const raw = social.recordId(namespace, 17);
  return `1${[...raw].map((c) => c.charCodeAt(0) % 10).join('')}`;
}

function jsonBody(body: Buffer): Record<string, string> {
  if (body.length === 0) return {};
  const text = body.toString('utf8');
  try {
    return JSON.parse(text) as Record<string, string>;
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

export function containerStatus(container: Container, nowMs: number) {
  if (container.publishedAs) return 'PUBLISHED';
  if (nowMs - container.createdMs >= EXPIRY_MS) return 'EXPIRED';
  return nowMs - container.createdMs < PROCESSING_MS
    ? 'IN_PROGRESS'
    : 'FINISHED';
}

const STATUS_TEXT: Record<string, string> = {
  IN_PROGRESS: 'In Progress: Media is still being processed.',
  FINISHED:
    'Finished: Media has been uploaded and it is ready to be published.',
  PUBLISHED: 'Published: Media has been successfully published.',
  EXPIRED: 'Expired: The container was not published within 24 hours.',
};

/** POST /{ig-user-id}/media — a Reels container. */
const createContainer: SocialRoute = ({
  url,
  method,
  req,
  res,
  body,
  social,
}) => {
  const instagram = social.signedIn('instagram');
  if (
    method !== 'POST' ||
    graphPath(url.pathname) !== `/${instagram.id}/media`
  ) {
    return false;
  }
  if (!metaAuthorize(url, req, res, social, PUBLISH_SCOPE, body)) return true;

  const params = { ...Object.fromEntries(url.searchParams), ...jsonBody(body) };
  if (params.media_type !== 'REELS' || !params.video_url) {
    sendJson(
      res,
      400,
      graphError(
        100,
        '(#100) The parameter video_url is required for media_type REELS',
      ),
    );
    return true;
  }

  // FILM-1731. "is_ai_generated <TRUE_OR_FALSE> An optional parameter to
  // provide a self-disclosure of AI usage in the post" (IG User Media
  // reference, read 2026-10-02). Anything but a boolean is refused as Graph
  // refuses a malformed parameter.
  const aiParam = params.is_ai_generated;
  if (aiParam !== undefined && !['true', 'false'].includes(String(aiParam))) {
    sendJson(
      res,
      400,
      graphError(
        100,
        '(#100) Param is_ai_generated must be a boolean (true or false)',
      ),
    );
    return true;
  }

  const container = social.add<Container>('ig-container', {
    id: digitsId(social, 'ig-container'),
    igId: instagram.id,
    createdMs: social.now(),
    videoUrl: params.video_url,
    caption: params.caption ?? '',
    ...(String(aiParam) === 'true' ? { aiGenerated: true } : {}),
  });
  sendJson(res, 200, { id: container.id });
  return true;
};

/** GET /{container-id}?fields=status_code,status */
const containerNode: SocialRoute = ({
  url,
  method,
  req,
  res,
  social,
  about,
}) => {
  const path = graphPath(url.pathname);
  const id = path && /^\/(\d+)$/.exec(path)?.[1];
  if (method !== 'GET' || !id) return false;
  const container = social
    .list<Container>('ig-container')
    .find((c) => c.id === id);
  if (!container) return false;

  if (!metaAuthorize(url, req, res, social)) return true;
  about(id);
  const code = containerStatus(container, social.now());
  const fields: Record<string, string> = {
    status_code: code,
    status: STATUS_TEXT[code]!,
  };
  const asked = (url.searchParams.get('fields') ?? 'id').split(',');
  sendJson(res, 200, {
    ...Object.fromEntries(
      asked.filter((f) => f in fields).map((f) => [f, fields[f]]),
    ),
    id,
  });
  return true;
};

/** POST /{ig-user-id}/media_publish {creation_id} */
const mediaPublish: SocialRoute = ({
  url,
  method,
  req,
  res,
  body,
  social,
  about,
}) => {
  const instagram = social.signedIn('instagram');
  if (
    method !== 'POST' ||
    graphPath(url.pathname) !== `/${instagram.id}/media_publish`
  ) {
    return false;
  }
  if (!metaAuthorize(url, req, res, social, PUBLISH_SCOPE, body)) return true;

  const creationId =
    url.searchParams.get('creation_id') ?? jsonBody(body).creation_id ?? '';
  const container = social
    .list<Container>('ig-container')
    .find((c) => c.id === creationId);
  const code = container ? containerStatus(container, social.now()) : null;

  if (!container || code !== 'FINISHED') {
    // Meta's "media not ready" (9007 / 2207027) while it is still processing.
    sendJson(
      res,
      400,
      graphError(
        9007,
        code === 'IN_PROGRESS'
          ? 'Media ID is not available'
          : 'The media could not be published',
        'OAuthException',
        2207027,
      ),
    );
    return true;
  }

  const post = social.createObject('instagram', instagram.id, {
    caption: container.caption,
    ...(container.aiGenerated ? { details: { isAiGenerated: true } } : {}),
  });
  container.publishedAs = post.id;
  about(post.id);
  sendJson(res, 200, { id: post.id });
  return true;
};

/** POST /{page-id}/video_reels — start, or finish. */
const videoReels: SocialRoute = ({
  url,
  method,
  req,
  res,
  body,
  social,
  self,
}) => {
  const page = social.signedIn('facebook');
  if (
    method !== 'POST' ||
    graphPath(url.pathname) !== `/${page.id}/video_reels`
  ) {
    return false;
  }
  if (!metaAuthorize(url, req, res, social, PAGE_SCOPE, body)) return true;

  const params = { ...Object.fromEntries(url.searchParams), ...jsonBody(body) };

  if (params.upload_phase === 'start') {
    const reel = social.add<FacebookReel>('fb-reel', {
      id: digitsId(social, 'fb-reel'),
      pageId: page.id,
      createdMs: social.now(),
      uploaded: false,
      published: false,
      description: '',
    });
    sendJson(res, 200, {
      video_id: reel.id,
      upload_url: `${self}/video-upload/v23.0/${reel.id}`,
    });
    return true;
  }

  const reel = social
    .list<FacebookReel>('fb-reel')
    .find((r) => r.id === params.video_id);
  if (params.upload_phase === 'finish' && reel?.uploaded) {
    reel.published = params.video_state === 'PUBLISHED';
    reel.description = params.description ?? '';
    if (reel.published) {
      social.createObject('facebook', page.id, { caption: reel.description });
    }
    sendJson(res, 200, { success: true });
    return true;
  }

  sendJson(res, 400, graphError(100, '(#100) Invalid parameter'));
  return true;
};

/** POST /video-upload/{version}/{video-id} — the rupload host. */
const rupload: SocialRoute = ({ url, method, req, res, social }) => {
  const id = /^\/video-upload\/v\d+\.\d+\/(\d+)$/.exec(url.pathname)?.[1];
  if (method !== 'POST' || !id) return false;
  if (!metaAuthorize(url, req, res, social, PAGE_SCOPE)) return true;

  const reel = social.list<FacebookReel>('fb-reel').find((r) => r.id === id);
  if (!reel || !req.headers['file_url']) {
    sendJson(res, 400, graphError(100, '(#100) Invalid upload'));
    return true;
  }
  reel.uploaded = true;
  sendJson(res, 200, { success: true });
  return true;
};

/** The Graph API's answer for an id that is not (or is no longer) there. */
function noSuchObject(res: Parameters<SocialRoute>[0]['res'], id: string) {
  sendJson(
    res,
    400,
    graphError(
      100,
      `Unsupported get request. Object with ID '${id}' does not exist, cannot be loaded due to missing permissions, or does not support this operation.`,
      'GraphMethodException',
      33,
    ),
  );
}

/**
 * GET /{video-id}?fields=status,permalink_url — the Reels guide's status
 * object, and the permalink as Meta answered it on a live Page: relative.
 */
const videoStatus: SocialRoute = ({ url, method, req, res, social }) => {
  const path = graphPath(url.pathname);
  const id = path && /^\/(\d+)$/.exec(path)?.[1];
  if (method !== 'GET' || !id) return false;
  const reel = social.list<FacebookReel>('fb-reel').find((r) => r.id === id);
  if (!reel) return false;
  if (!metaAuthorize(url, req, res, social)) return true;
  if (reel.deleted) {
    noSuchObject(res, id);
    return true;
  }
  const fields = (url.searchParams.get('fields') ?? '').split(',');

  const processing = social.now() - reel.createdMs < PROCESSING_MS;
  sendJson(res, 200, {
    status: {
      video_status: !reel.uploaded
        ? 'uploading'
        : processing
          ? 'processing'
          : 'ready',
    },
    ...(fields.includes('permalink_url') && {
      permalink_url: `/reel/${id}/`,
    }),
    id,
  });
  return true;
};

/** DELETE /{video-id} — `{ success: true }`, as a live Page answered it. */
const deleteVideo: SocialRoute = ({ url, method, req, res, social }) => {
  const path = graphPath(url.pathname);
  const id = path && /^\/(\d+)$/.exec(path)?.[1];
  if (method !== 'DELETE' || !id) return false;
  const reel = social.list<FacebookReel>('fb-reel').find((r) => r.id === id);
  if (!reel) return false;
  if (!metaAuthorize(url, req, res, social, PAGE_SCOPE)) return true;
  if (reel.deleted) {
    noSuchObject(res, id);
    return true;
  }
  reel.deleted = true;
  sendJson(res, 200, { success: true });
  return true;
};

export const metaPublishingRoutes: readonly SocialRoute[] = [
  createContainer,
  mediaPublish,
  containerNode,
  videoReels,
  rupload,
  videoStatus,
  deleteVideo,
];
