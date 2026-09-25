import 'server-only';

import { decrypt } from '@kit/shared/crypto';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import {
  type OAuthApp,
  SAVED_CREDENTIAL_APPS,
  type SavedCredentialApp,
  type SavedCredentialSource,
} from '../oauth/apps';

/**
 * Where each OAuth app's client id and secret come from - for connect, for
 * the callback's code exchange and for token refresh alike (KB-29). A refresh
 * token is bound to the client that minted it, so these three must agree;
 * they do by all calling `getOAuthAppCredentials`.
 *
 * One rule for every app (KB-36): the row saved at /admin/platforms if the
 * app can be saved there (`SAVED_CREDENTIAL_APPS`); otherwise, or when no row
 * is saved, the app's env pair if it has one. A saved row that cannot be read
 * or decrypted means "not configured". It does not fall back to env, which
 * would hide a broken row behind a different app.
 *
 * Deliberately not a `'use server'` module: every export of one is a server
 * action candidate, and this returns decrypted secrets.
 */

export interface OAuthAppCredentials {
  clientId: string;
  clientSecret: string;
}

/** Environment variable names, read at call time. */
interface EnvSource {
  clientId: string;
  clientSecret: string;
}

const ENV_SOURCES: Partial<Record<OAuthApp, EnvSource>> = {
  tiktok: {
    clientId: 'TIKTOK_CLIENT_KEY',
    clientSecret: 'TIKTOK_CLIENT_SECRET',
  },
  linkedin: {
    clientId: 'LINKEDIN_CLIENT_ID',
    clientSecret: 'LINKEDIN_CLIENT_SECRET',
  },
  twitter: {
    clientId: 'TWITTER_CLIENT_ID',
    clientSecret: 'TWITTER_CLIENT_SECRET',
  },
};

function isSavedCredentialApp(app: OAuthApp): app is SavedCredentialApp {
  return (SAVED_CREDENTIAL_APPS as readonly OAuthApp[]).includes(app);
}

/** Names the sources for a log line or an error - never a value. */
export function describeCredentialSource(app: OAuthApp): string {
  const env = ENV_SOURCES[app];
  const sources = [];

  if (isSavedCredentialApp(app))
    sources.push(`oauth_app_credentials['${app}']`);
  if (env) sources.push(`${env.clientId} / ${env.clientSecret}`);

  return sources.join(' or ');
}

function readEnvCredentials(app: OAuthApp): OAuthAppCredentials | null {
  const env = ENV_SOURCES[app];
  if (!env) return null;

  const clientId = process.env[env.clientId];
  const clientSecret = process.env[env.clientSecret];

  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

type SavedRead =
  | { kind: 'absent' }
  | { kind: 'unreadable' }
  | { kind: 'saved'; credentials: OAuthAppCredentials };

async function readSavedCredentials(
  app: SavedCredentialApp,
): Promise<SavedRead> {
  const logger = await getLogger();
  const ctx = {
    name: 'oauth-app-credentials',
    app,
    credentialSource: `oauth_app_credentials['${app}']`,
  };

  const { data, error } = await getSupabaseServerAdminClient()
    .from('oauth_app_credentials')
    .select('client_id, client_secret_encrypted')
    .eq('platform', app)
    .maybeSingle();

  if (error) {
    logger.error({ ...ctx, error }, 'Failed to read OAuth app credentials');
    return { kind: 'unreadable' };
  }

  if (!data) return { kind: 'absent' };

  try {
    return {
      kind: 'saved',
      credentials: {
        clientId: data.client_id,
        clientSecret: await decrypt(data.client_secret_encrypted),
      },
    };
  } catch (cause) {
    logger.error(
      { ...ctx, error: cause instanceof Error ? cause.message : String(cause) },
      'Failed to decrypt the OAuth app client secret',
    );
    return { kind: 'unreadable' };
  }
}

/**
 * The app's credentials, or `null` when they are not configured - including
 * when the saved secret cannot be decrypted or the read fails, which an
 * operator fixes the same way.
 */
export async function getOAuthAppCredentials(
  app: OAuthApp,
): Promise<OAuthAppCredentials | null> {
  if (isSavedCredentialApp(app)) {
    const saved = await readSavedCredentials(app);

    if (saved.kind === 'saved') return saved.credentials;
    if (saved.kind === 'unreadable') return null;
  }

  return readEnvCredentials(app);
}

/**
 * For /admin/platforms: the source each admin-configurable app resolves to
 * right now, by the same rule as `getOAuthAppCredentials`. It returns no
 * credential value.
 */
export async function getSavedCredentialAppSources(): Promise<
  Record<SavedCredentialApp, SavedCredentialSource>
> {
  const entries = await Promise.all(
    SAVED_CREDENTIAL_APPS.map(async (app) => {
      const saved = await readSavedCredentials(app);

      if (saved.kind !== 'absent') return [app, saved.kind] as const;

      return [app, readEnvCredentials(app) ? 'env' : 'none'] as const;
    }),
  );

  return Object.fromEntries(entries) as Record<
    SavedCredentialApp,
    SavedCredentialSource
  >;
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
