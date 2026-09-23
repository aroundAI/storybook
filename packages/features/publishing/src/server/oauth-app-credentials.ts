import 'server-only';

import { decrypt } from '@kit/shared/crypto';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import type { OAuthApp } from '../oauth/apps';

/**
 * Where each OAuth app's client id and secret come from - for connect, for
 * the callback's code exchange and for token refresh alike (KB-29). A refresh
 * token is bound to the client that minted it, so these three must agree;
 * they do by all calling `getOAuthAppCredentials`.
 *
 * Deliberately not a `'use server'` module: every export of one is a server
 * action candidate, and this returns decrypted secrets.
 */

export interface OAuthAppCredentials {
  clientId: string;
  clientSecret: string;
}

type CredentialSource =
  /** The `oauth_app_credentials` row for the app, saved at /admin/platforms. */
  | { kind: 'table' }
  /** Environment variable names, read at call time. */
  | { kind: 'env'; clientId: string; clientSecret: string };

const SOURCES: Record<OAuthApp, CredentialSource> = {
  youtube: { kind: 'table' },
  meta: { kind: 'table' },
  // The /admin/platforms TikTok row is not read: TikTok connect has always
  // used env (KB-36).
  tiktok: {
    kind: 'env',
    clientId: 'TIKTOK_CLIENT_KEY',
    clientSecret: 'TIKTOK_CLIENT_SECRET',
  },
  linkedin: {
    kind: 'env',
    clientId: 'LINKEDIN_CLIENT_ID',
    clientSecret: 'LINKEDIN_CLIENT_SECRET',
  },
  twitter: {
    kind: 'env',
    clientId: 'TWITTER_CLIENT_ID',
    clientSecret: 'TWITTER_CLIENT_SECRET',
  },
};

/** Names the source for a log line or an error - never a value. */
export function describeCredentialSource(app: OAuthApp): string {
  const source = SOURCES[app];

  return source.kind === 'table'
    ? `oauth_app_credentials['${app}']`
    : `${source.clientId} / ${source.clientSecret}`;
}

/**
 * The app's credentials, or `null` when they are not configured - including
 * when the stored secret cannot be decrypted or the read fails, which an
 * operator fixes the same way.
 */
export async function getOAuthAppCredentials(
  app: OAuthApp,
): Promise<OAuthAppCredentials | null> {
  const source = SOURCES[app];

  if (source.kind === 'env') {
    const clientId = process.env[source.clientId];
    const clientSecret = process.env[source.clientSecret];

    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  const logger = await getLogger();
  const ctx = {
    name: 'oauth-app-credentials',
    app,
    credentialSource: describeCredentialSource(app),
  };

  const { data, error } = await getSupabaseServerAdminClient()
    .from('oauth_app_credentials')
    .select('client_id, client_secret_encrypted')
    .eq('platform', app)
    .maybeSingle();

  if (error) {
    logger.error({ ...ctx, error }, 'Failed to read OAuth app credentials');
    return null;
  }

  if (!data) return null;

  try {
    return {
      clientId: data.client_id,
      clientSecret: await decrypt(data.client_secret_encrypted),
    };
  } catch (cause) {
    logger.error(
      { ...ctx, error: cause instanceof Error ? cause.message : String(cause) },
      'Failed to decrypt the OAuth app client secret',
    );
    return null;
  }
}

/** Thrown by refresh when `getOAuthAppCredentials` has nothing to use. */
export class AppNotConfiguredError extends Error {
  constructor(readonly app: OAuthApp) {
    super(
      `${app} app credentials are not configured (${describeCredentialSource(app)})`,
    );
    this.name = 'AppNotConfiguredError';
  }
}
