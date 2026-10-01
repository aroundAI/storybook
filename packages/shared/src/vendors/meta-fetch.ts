import {
  META_GRAPH_BASE,
  META_GRAPH_VERSION,
  META_GRAPH_VIDEO_BASE,
} from './meta';

export interface MetaFetchInit extends RequestInit {
  /**
   * Sent as `Authorization: Bearer`, never as `access_token=` in the URL,
   * where it would reach server logs, proxies and anything that prints a
   * failed request's URL (FILM-1728 §7.4).
   */
  token?: string;
  /** Non-resumable Page video uploads go to graph-video. */
  host?: 'graph' | 'video';
}

/**
 * Meta's rate-limit headers. Not acted on here (content-analytics paces on
 * them); carried on the version line so whoever reads it sees the load the
 * call was made under.
 */
const USAGE_HEADERS = [
  'x-app-usage',
  'x-business-use-case-usage',
  'x-page-usage',
] as const;

/** Served versions already reported by this process. */
const reported = new Set<string>();

/**
 * The one way this repository calls Meta Graph (FILM-1728 §7.3.A). `path` is
 * everything after the version — `/me/accounts?fields=id` — so no caller
 * builds a Graph URL, and none can name a version.
 *
 * Every response's `facebook-api-version` header is compared with
 * `META_GRAPH_VERSION`. Meta does not reject a call to an expired version: it
 * serves the next oldest usable one, and says so only in that header. The
 * first mismatch a process sees is logged as an error naming the vendor, the
 * pin, what was served and the endpoint; later ones are not, so the check
 * costs nothing on a busy path. A response without the header says nothing:
 * there is nothing to compare.
 *
 * Deprecation warnings in the body are not read: Graph v26.0 retired the
 * `debug` parameter and its `__debug__` envelope for every version from
 * 2026-10-27, so the header is the signal left.
 */
export async function metaFetch(
  path: string,
  { token, host = 'graph', headers, ...init }: MetaFetchInit = {},
): Promise<Response> {
  if (!path.startsWith('/')) {
    throw new Error(
      `metaFetch takes a path below the Graph version (/me/accounts), not ${path}`,
    );
  }

  const sent = new Headers(headers);
  if (token) sent.set('Authorization', `Bearer ${token}`);

  const base = host === 'video' ? META_GRAPH_VIDEO_BASE : META_GRAPH_BASE;
  const response = await fetch(`${base}${path}`, { ...init, headers: sent });

  reportServedVersion(response.headers, `${init.method ?? 'GET'} ${path}`);

  return response;
}

/** `headers` is undefined only for a stand-in Response; nothing to compare. */
function reportServedVersion(headers: Headers | undefined, call: string) {
  const served = headers?.get('facebook-api-version');
  if (!headers) return;
  if (!served || served === META_GRAPH_VERSION || reported.has(served)) return;
  reported.add(served);

  // Path only: the query string is where secrets used to ride.
  const endpoint = call.split('?')[0];
  const usage = USAGE_HEADERS.flatMap((name) => {
    const value = headers.get(name);
    return value ? [`${name}=${value}`] : [];
  });

  console.error(
    [
      '[meta-graph] served version is not the pin (FILM-1728):',
      'vendor=meta',
      `expected=${META_GRAPH_VERSION}`,
      `served=${served}`,
      `endpoint=${endpoint}`,
      ...usage,
    ].join(' '),
  );
}
