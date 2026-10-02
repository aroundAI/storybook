import { MCP_SCOPES } from '../../scopes';

/**
 * RFC 9728 protected-resource metadata, served at
 * `/.well-known/oauth-protected-resource`. It is how an MCP client finds
 * the authorization server after a 401: ours when `MCP_AUTH_SERVER=own`,
 * Supabase Auth's issuer when `MCP_AUTH_SERVER=supabase`.
 */
export function protectedResourceMetadata(input: {
  resource: string;
  authorizationServer: string;
}) {
  return {
    resource: input.resource,
    authorization_servers: [input.authorizationServer],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'StoryBook MCP',
  };
}

/**
 * RFC 8414 authorization-server metadata for our own server, served at
 * `/.well-known/oauth-authorization-server`. Public clients only (no client
 * authentication), authorization code with PKCE S256, refresh tokens, DCR,
 * and client metadata documents as client ids.
 */
export function authorizationServerMetadata(input: { issuer: string }) {
  const issuer = new URL(input.issuer).origin;

  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
    service_documentation: `${issuer}/docs/mcp`,
  };
}

export type ProtectedResourceMetadata = ReturnType<
  typeof protectedResourceMetadata
>;
export type AuthorizationServerMetadata = ReturnType<
  typeof authorizationServerMetadata
>;
