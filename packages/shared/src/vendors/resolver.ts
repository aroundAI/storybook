/**
 * Every vendor host this repository calls, and the one function that resolves
 * them (FILM-1801). A host is written here and nowhere else;
 * `vendor-api-versions.test.ts` reads this list and fails on a literal found
 * outside this directory.
 *
 * A host is an origin. Version and path segments stay with the caller -
 * `${vendorUrl('meta-graph')}/${META_GRAPH_VERSION}` - so a stand-in serving
 * a host sees every version path asked of it.
 *
 * Pure: no imports, so client code, server code and the lambdas can all load
 * it. It reads `process.env` and nothing else.
 */
export const VENDORS = {
  'meta-graph': 'https://graph.facebook.com',
  'meta-graph-video': 'https://graph-video.facebook.com',
  /** The Facebook Login dialog. Followed by the user's browser. */
  'meta-oauth': 'https://www.facebook.com',
  tiktok: 'https://open.tiktokapis.com',
  /** Followed by the user's browser. */
  'tiktok-oauth': 'https://www.tiktok.com',
  'x-api': 'https://api.x.com',
  /** Followed by the user's browser. */
  'x-oauth': 'https://x.com',
  'linkedin-api': 'https://api.linkedin.com',
  /** Authorize is followed by the browser; the token endpoint shares the host. */
  'linkedin-oauth': 'https://www.linkedin.com',
  /** Followed by the user's browser. */
  'google-oauth': 'https://accounts.google.com',
  'google-token': 'https://oauth2.googleapis.com',
  /**
   * `rootUrl` for YouTube Data v3, passed to both `googleapis` and
   * `@googleapis/youtube`. This is the SDKs' own default; `www.googleapis.com`
   * appears in this repository only inside OAuth scope identifiers.
   */
  'youtube-data': 'https://youtube.googleapis.com',
  'youtube-analytics': 'https://youtubeanalytics.googleapis.com',
  'youtube-reporting': 'https://youtubereporting.googleapis.com',
  gemini: 'https://generativelanguage.googleapis.com',
  /**
   * Vertex AI Express (`GEMINI_VERTEXAI=true`). Called with an API key, which
   * makes `@google/genai` drop project and location, so it is always the
   * global endpoint, never a regional one (FILM-1805 §3.2).
   */
  'gemini-vertex': 'https://aiplatform.googleapis.com',
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com',
  voyage: 'https://api.voyageai.com',
  elevenlabs: 'https://api.elevenlabs.io',
  playht: 'https://api.play.ht',
  suno: 'https://api.suno.ai',
  udio: 'https://api.udio.com',
  synclabs: 'https://api.synclabs.so',
  piapi: 'https://api.piapi.ai',
  'brave-search': 'https://api.search.brave.com',
  'semantic-scholar': 'https://api.semanticscholar.org',
  newsapi: 'https://newsapi.org',
  'archive-org': 'https://archive.org',
  crossref: 'https://api.crossref.org',
} as const;

export type Vendor = keyof typeof VENDORS;

type Env = Record<string, string | undefined>;

const OVERRIDE_PREFIX = 'VENDOR_URL_';

/** `meta-graph` is overridden by `VENDOR_URL_META_GRAPH`. */
export function vendorUrlEnvName(vendor: Vendor) {
  return `${OVERRIDE_PREFIX}${vendor.toUpperCase().replaceAll('-', '_')}`;
}

/**
 * Whether `VENDOR_URL_*` is honoured at all. An override redirects requests
 * that carry OAuth tokens and API keys, so every condition must hold and
 * anything unrecognised refuses:
 *
 * - `NODE_ENV` is `development` or `test`, by name. The rule is an allow-list
 *   rather than `!== 'production'` because the worker lambdas in
 *   `sst.config.ts` run in production with `NODE_ENV` unset.
 * - `VENDOR_SANDBOX` is exactly `1`.
 * - The process is not an AWS Lambda. The runtime reserves
 *   `AWS_LAMBDA_FUNCTION_NAME`, so no deploy configuration can clear it.
 *
 * `NODE_ENV` is read from the `env` argument and never written as
 * `process.env.NODE_ENV`: `next build` inlines that expression as
 * `production` even under `build:test`, which is the bundle sandbox-backed
 * E2E runs against (`NODE_ENV=test next start`).
 */
export function vendorSandboxEnabled(env: Env = process.env) {
  return (
    (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') &&
    env.VENDOR_SANDBOX === '1' &&
    !env.AWS_LAMBDA_FUNCTION_NAME
  );
}

/**
 * An override may only name this machine or a container beside it - a
 * sandbox is never anywhere else, and a public address is what an exfiltration
 * would need.
 */
function isLocalHostname(hostname: string) {
  if (hostname.startsWith('[')) return hostname === '[::1]';

  return (
    !hostname.includes('.') ||
    hostname.endsWith('.localhost') ||
    hostname === 'host.docker.internal' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

function parseOverride(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const acceptable =
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    isLocalHostname(url.hostname) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash;

  return acceptable ? `${url.origin}${url.pathname}`.replace(/\/+$/, '') : null;
}

/**
 * The origin to call for a vendor: the real host, unless
 * `vendorSandboxEnabled` and `VENDOR_URL_<NAME>` names a local address.
 *
 * With the sandbox enabled a malformed or non-local override throws instead
 * of falling back, so a typo in `local.env` cannot send a development session
 * to the real vendor unnoticed. With it disabled the override is never read.
 */
export function vendorUrl(vendor: Vendor, env: Env = process.env): string {
  if (!vendorSandboxEnabled(env)) return VENDORS[vendor];

  const name = vendorUrlEnvName(vendor);
  const value = env[name];

  if (!value) return VENDORS[vendor];

  const override = parseOverride(value);

  if (!override) {
    throw new Error(
      `${name} must be an http(s) URL on a local address (localhost, 127.0.0.1, a container name), without credentials or a query - got "${value}"`,
    );
  }

  return override;
}

/**
 * The SDKs' own base-URL variables. Each SDK reads its variable only when it
 * is constructed without a base URL, and every construction site now passes
 * one from `vendorUrl()` (FILM-1805), so these are never used. They are named
 * here so a deploy that still sets one says so rather than looking live.
 */
export const SDK_BASE_URL_VARIABLES = [
  'ANTHROPIC_BASE_URL',
  'GOOGLE_GEMINI_BASE_URL',
  'GOOGLE_VERTEX_BASE_URL',
  'OPENAI_BASE_URL',
] as const;

/**
 * The variables that are set and will not be used: every `VENDOR_URL_*` while
 * the sandbox is disabled, any that names no vendor while it is enabled, and
 * any `SDK_BASE_URL_VARIABLES` at all. `apps/web/instrumentation.ts` logs
 * each as an error at server start - by name, never by value - so a deploy
 * that carries one says so instead of degrading silently.
 */
export function ignoredVendorOverrides(env: Env = process.env) {
  const known = new Set(
    (Object.keys(VENDORS) as Vendor[]).map(vendorUrlEnvName),
  );
  const sdkVariables = new Set<string>(SDK_BASE_URL_VARIABLES);

  return Object.keys(env)
    .filter((name) => env[name])
    .filter(
      (name) =>
        sdkVariables.has(name) ||
        (name.startsWith(OVERRIDE_PREFIX) &&
          (!vendorSandboxEnabled(env) || !known.has(name))),
    )
    .sort();
}
