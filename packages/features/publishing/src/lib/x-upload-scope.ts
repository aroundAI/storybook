import { X_MEDIA_UPLOAD_SCOPE } from '@kit/shared/vendors';

/**
 * FILM-1729 §4.3. `/2/media/upload` refuses a token without `media.write`,
 * and refresh cannot add a scope, so an X connection made before the scope
 * was requested can never upload video until it is connected again. The
 * grant is recorded at connect time (`platform_connections.scopes`); a
 * connection that recorded none is treated as lacking it, since every such
 * row predates the scope.
 */
export function holdsXUploadScope(scopes: readonly string[] | null): boolean {
  return (scopes ?? []).includes(X_MEDIA_UPLOAD_SCOPE);
}

/** The refusal shown in place of the publish, naming each X account. */
export function xUploadScopeRefusal(accountNames: readonly string[]): string {
  const accounts = accountNames.map((name) => `@${name}`).join(', ');

  return `${accounts} was connected before X allowed us to upload video (the ${X_MEDIA_UPLOAD_SCOPE} permission). In Settings → Platforms, disconnect X and connect it again, then publish.`;
}
