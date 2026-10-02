/**
 * The OAuth 2.1 authorization server (FILM-1907): metadata, client
 * registration, the authorize request and consent, the token and revoke
 * grants, and the environment that selects the authorization server.
 * Route files under `apps/web/app/oauth/*` and `apps/web/app/.well-known/*`
 * are thin wrappers over these.
 */
export {
  AUTHORIZATION_CODE_TTL_SECONDS,
  DEFAULT_SCOPES,
  denialLocation,
  issueAuthorizationCode,
  parseAuthorizeRequest,
  parseScopes,
  type AuthorizeDeps,
  type AuthorizeParse,
  type AuthorizeRequest,
} from './authorize';
export {
  CLIENT_ID_PREFIX,
  isAllowedRedirectUri,
  isFetchableMetadataUrl,
  registerClient,
  resolveClient,
  validateClientMetadata,
  type ClientMetadata,
  type ClientRegistrationResponse,
} from './clients';
export {
  authorizationServerFromEnv,
  createMcpTokenVerifierFromEnv,
  mcpAuthServerFromEnv,
  mcpResourceFromEnv,
  siteOriginFromEnv,
  supabaseIssuerFromEnv,
  type McpAuthServer,
} from './config';
export { OAuthError, toOAuthError, type OAuthErrorCode } from './errors';
export {
  authorizationServerMetadata,
  protectedResourceMetadata,
  type AuthorizationServerMetadata,
  type ProtectedResourceMetadata,
} from './metadata';
export {
  codeChallengeFor,
  isCodeChallengeShape,
  isCodeVerifierShape,
  verifyPkce,
} from './pkce';
export {
  MCP_RESOURCE_PATH,
  canonicalResource,
  mcpResourceUrl,
  resourceMatches,
} from './resource';
export { handleRevokeRequest } from './revoke';
export {
  createMemoryOAuthStore,
  type AuthorizationCodeRecord,
  type ConnectionRecord,
  type OAuthClientRecord,
  type OAuthStore,
  type OAuthTokenKind,
  type TokenRecord,
} from './store';
export { createSupabaseOAuthStore } from './supabase-store';
export {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
  handleTokenRequest,
  type TokenDeps,
  type TokenResponse,
} from './token';
