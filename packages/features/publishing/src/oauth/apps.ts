/**
 * The OAuth apps this product connects through - one per developer-console
 * registration, so Instagram and Facebook share `meta`. Pure, so client code
 * (the connect-failure page) can bind its own list to this one.
 */
export const OAUTH_APPS = [
  'youtube',
  'tiktok',
  'meta',
  'twitter',
  'linkedin',
] as const;

export type OAuthApp = (typeof OAUTH_APPS)[number];
