/**
 * The OAuth apps this product connects through - one per developer-console
 * registration, so Instagram and Facebook share `meta`. Pure, so client code
 * (the connect-failure page) can bind its own list to this one.
 */
export const OAUTH_APPS = ['youtube', 'tiktok', 'meta', 'twitter'] as const;

export type OAuthApp = (typeof OAUTH_APPS)[number];

/**
 * The apps whose credentials a super admin saves at /admin/platforms. One
 * list drives the page's cards, the save action and the resolver, so the
 * page cannot offer an app the resolver ignores (KB-36). It must stay equal
 * to the `oauth_app_credentials.platform` CHECK.
 */
export const SAVED_CREDENTIAL_APPS = ['youtube', 'tiktok', 'meta'] as const;

export type SavedCredentialApp = (typeof SAVED_CREDENTIAL_APPS)[number];

/** Where an admin-configurable app's credentials come from right now. */
export type SavedCredentialSource = 'saved' | 'unreadable' | 'env' | 'none';
