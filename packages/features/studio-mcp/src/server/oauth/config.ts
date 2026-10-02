import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import { McpScopeSchema } from '../../scopes';
import type { McpTokenVerifier } from '../../verifier';
import { createOwnTokenVerifier } from '../own-verifier';
import {
  createSupabaseTokenVerifier,
  supabaseJwks,
} from '../supabase-verifier';
import { mcpResourceUrl } from './resource';

/**
 * The environment the OAuth server and the MCP endpoint read (FILM-1907):
 *
 * - `NEXT_PUBLIC_SITE_URL`: the public origin; the MCP resource is
 *   `<origin>/api/mcp` and, with `own`, the authorization server issuer.
 * - `MCP_RESOURCE_URL`: overrides the resource URL, for a deployment that
 *   serves the MCP endpoint on another host.
 * - `MCP_AUTH_SERVER`: `own` (default) or `supabase`. Selects the verifier
 *   `withMcpAuth` is given and the authorization server the
 *   protected-resource metadata names.
 * - `MCP_SUPABASE_OAUTH_ISSUER`: with `supabase`, the issuer of the JWTs
 *   (default `<NEXT_PUBLIC_SUPABASE_URL>/auth/v1`).
 */
export type McpAuthServer = 'own' | 'supabase';

export function mcpAuthServerFromEnv(): McpAuthServer {
  const value = process.env.MCP_AUTH_SERVER ?? 'own';

  if (value !== 'own' && value !== 'supabase') {
    throw new Error(`MCP_AUTH_SERVER must be own or supabase, not "${value}"`);
  }

  return value;
}

export function siteOriginFromEnv() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;

  if (!configured) {
    throw new Error('NEXT_PUBLIC_SITE_URL is not set');
  }

  return new URL(configured).origin;
}

export function mcpResourceFromEnv() {
  const override = process.env.MCP_RESOURCE_URL;

  return override ? new URL(override).toString().replace(/\/+$/, '') : mcpResourceUrl(siteOriginFromEnv());
}

export function supabaseIssuerFromEnv() {
  const override = process.env.MCP_SUPABASE_OAUTH_ISSUER;

  if (override) return override;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  }

  return `${supabaseUrl}/auth/v1`;
}

/** What the protected-resource metadata names as the authorization server. */
export function authorizationServerFromEnv() {
  return mcpAuthServerFromEnv() === 'supabase'
    ? supabaseIssuerFromEnv()
    : siteOriginFromEnv();
}

/** The verifier `withMcpAuth` runs with, as `MCP_AUTH_SERVER` selects it. */
export function createMcpTokenVerifierFromEnv(
  admin: SupabaseClient<Database>,
): McpTokenVerifier {
  const resource = mcpResourceFromEnv();

  if (mcpAuthServerFromEnv() === 'own') {
    return createOwnTokenVerifier(admin, undefined, { resource });
  }

  const issuer = supabaseIssuerFromEnv();

  return createSupabaseTokenVerifier({
    issuer,
    audience: resource,
    key: supabaseJwks(issuer.replace(/\/auth\/v1$/, '')),
    async resolveConnection({ userId, clientId }) {
      const { data, error } = await admin
        .from('mcp_connections')
        .select('id, user_id, account_id, kind, name, scopes, revoked_at')
        .eq('user_id', userId)
        .eq('client_id', clientId)
        .eq('kind', 'oauth')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(`mcp_connections lookup failed: ${error.message}`);
      }

      if (!data) return null;

      return {
        id: data.id,
        userId: data.user_id,
        accountId: data.account_id,
        kind: 'oauth',
        clientName: data.name,
        scopes: McpScopeSchema.array().parse(data.scopes),
        revokedAt: data.revoked_at,
      };
    },
  });
}
