import { type Handler, sendJson } from '../http';
import { summarise } from '../ledger';
import type { SandboxState } from '../state';
import type { SocialState } from './state';

/**
 * The five social origins (FILM-1802 §2), one port each so every vendor is
 * a distinct origin as in production. Each vendor's endpoints arrive in its
 * own PR; until then an origin answers every path with a 404 and records it,
 * so a call the app makes that nothing serves yet shows in the ledger rather
 * than silently going elsewhere.
 */
export const SOCIAL_ORIGINS = {
  meta: {
    port: 4101,
    resolverNames: ['meta-graph', 'meta-graph-video', 'meta-oauth'],
  },
  tiktok: { port: 4102, resolverNames: ['tiktok', 'tiktok-oauth'] },
  google: {
    port: 4103,
    resolverNames: [
      'google-oauth',
      'google-token',
      'youtube-data',
      'youtube-analytics',
      'youtube-reporting',
    ],
  },
  x: { port: 4104, resolverNames: ['x-api', 'x-oauth'] },
  linkedin: { port: 4105, resolverNames: ['linkedin-api', 'linkedin-oauth'] },
} as const;

export type SocialOrigin = keyof typeof SOCIAL_ORIGINS;

/** A route a vendor module serves: return true once it has answered. */
export type SocialRoute = (ctx: SocialRequest) => boolean | Promise<boolean>;

export interface SocialRequest {
  req: Parameters<Handler>[0];
  res: Parameters<Handler>[1];
  body: Buffer;
  url: URL;
  method: string;
  state: SandboxState;
  social: SocialState;
  /** This origin as the app reached it, e.g. `http://127.0.0.1:4103`. */
  self: string;
  /** Tag the ledger entry with the object the call was about. */
  about(objectId: string): void;
}

/** A vendor's own error body for an injected failure (`/__sandbox/fail`). */
export type FailureShape = (status: number) => { status: number; body: unknown };

const SECRET_KEYS =
  'access_token|refresh_token|client_secret|id_token|code|code_verifier|token|fb_exchange_token|input_token';

/**
 * The ledger records what was sent and served, never a credential: token
 * requests carry secrets in their bodies and token responses in theirs.
 * Values under those keys, in JSON or a form body, become `[redacted]`.
 */
export function redactSecrets(text: string) {
  return text
    .replace(
      new RegExp(`("(?:${SECRET_KEYS})"\\s*:\\s*)"[^"]*"`, 'g'),
      '$1"[redacted]"',
    )
    .replace(
      new RegExp(`(^|[?&\\s])((?:${SECRET_KEYS})=)[^&\\s]*`, 'g'),
      '$1$2[redacted]',
    );
}

function hasCredential(req: Parameters<Handler>[0], url: URL) {
  return Boolean(
    req.headers.authorization ||
      url.searchParams.get('access_token') ||
      url.searchParams.get('client_secret'),
  );
}

export function socialHandler(
  origin: SocialOrigin,
  state: SandboxState,
  social: SocialState,
  routes: readonly SocialRoute[] = [],
  failure?: FailureShape,
): Handler {
  return async (req, res, body) => {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://sandbox.localhost');
    const method = req.method ?? 'GET';
    let object: string | undefined;
    let injectedFailure = false;

    // Record what was served, whichever route answered.
    const end = res.end.bind(res);
    let served = '';
    res.end = ((chunk?: unknown, ...rest: unknown[]) => {
      if (typeof chunk === 'string') served = chunk;
      else if (Buffer.isBuffer(chunk)) served = chunk.toString('utf8');
      return (end as (...args: unknown[]) => typeof res)(chunk, ...rest);
    }) as typeof res.end;

    try {
      let answered = false;

      const injected = state.takeFailure(origin, url.pathname);
      if (injected) {
        const shaped = failure?.(injected.status) ?? {
          status: injected.status,
          body: { error: { code: injected.status, message: 'injected failure' } },
        };
        sendJson(res, shaped.status, shaped.body);
        answered = true;
        injectedFailure = true;
      }

      for (const route of answered ? [] : routes) {
        answered = await route({
          req,
          res,
          body,
          url,
          method,
          state,
          social,
          self: `http://${req.headers.host ?? '127.0.0.1'}`,
          about: (id) => {
            object = id;
          },
        });
        if (answered) break;
      }

      if (!answered) {
        sendJson(res, 404, {
          error: {
            message: `vendor-sandbox does not serve ${method} ${url.pathname} for ${origin} yet`,
            code: 404,
          },
        });
      }
    } finally {
      state.ledger.record({
        vendor: origin,
        method,
        path: url.pathname,
        keyPresent: hasCredential(req, url),
        status: res.statusCode,
        requestSummary: body.length
          ? summarise(redactSecrets(body.toString('utf8')))
          : undefined,
        responseSummary: served ? summarise(redactSecrets(served)) : undefined,
        durationMs: Date.now() - started,
        ...(injectedFailure ? { injectedFailure } : {}),
        ...(object ? { object } : {}),
      });
    }
  };
}
