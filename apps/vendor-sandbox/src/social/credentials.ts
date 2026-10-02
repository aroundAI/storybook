/**
 * The one OAuth client each sandboxed platform accepts (FILM-1802 §2).
 * Invented, fixed, and useless anywhere else: the sandbox refuses any other
 * client id, so a real app's credentials cannot work against it, and these
 * cannot work against a real vendor.
 *
 * The same values are written where the app reads them: the env block
 * (`scripts/lib/vendor-sandbox-env.d/social.sh`) for TikTok and X,
 * and `oauth_app_credentials` (`pnpm --filter vendor-sandbox
 * seed-credentials`) for YouTube and Meta.
 */
export const SANDBOX_CLIENTS = {
  youtube: {
    clientId: 'sandbox-youtube.apps.localhost',
    clientSecret: 'sandbox-youtube-client-secret-not-a-real-secret',
  },
  meta: {
    clientId: 'sandbox-meta-app',
    clientSecret: 'sandbox-meta-app-secret-not-a-real-secret',
  },
  tiktok: {
    clientId: 'sandboxtiktokclientkey',
    clientSecret: 'sandbox-tiktok-client-secret-not-a-real-secret',
  },
  twitter: {
    clientId: 'sandbox-x-client-id',
    clientSecret: 'sandbox-x-client-secret-not-a-real-secret',
  },
} as const;

export type SandboxClientApp = keyof typeof SANDBOX_CLIENTS;

/** The env variables the app reads for the two env-configured apps. */
export const CLIENT_ENV = {
  tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
  twitter: ['TWITTER_CLIENT_ID', 'TWITTER_CLIENT_SECRET'],
} as const satisfies Partial<
  Record<SandboxClientApp, readonly [string, string]>
>;

/** The apps whose credentials live in `oauth_app_credentials`. */
export const TABLE_CLIENTS = ['youtube', 'meta'] as const;
