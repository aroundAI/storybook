import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import { McpToolError } from '../errors';
import type { McpPrincipal } from '../principal';
import type { McpTokenRefusal, McpTokenVerifier } from '../verifier';
import { type McpJwtSigner } from './jwt';
import { bearerToken } from './token';

export interface McpAuthDeps {
  verifier: McpTokenVerifier;
  signer: McpJwtSigner;
  createUserClient: (jwt: string) => SupabaseClient<Database>;
  /**
   * Whether `userId` is still a member of `accountId`, asked as the user:
   * the default calls `has_role_on_account` through the minted client, which
   * also proves the minted JWT is one PostgREST accepts.
   */
  checkMembership?: (
    client: SupabaseClient<Database>,
    accountId: string,
  ) => Promise<boolean>;
  /** Records the connection's last use; failures are logged, never fatal. */
  touchConnection?: (connectionId: string) => Promise<void>;
}

export type McpAuthResult =
  | { ok: true; principal: McpPrincipal }
  | {
      ok: false;
      /** 401 for a credential problem, 403 for a membership one. */
      status: 401 | 403;
      error: McpToolError;
    };

const REFUSALS: Record<McpTokenRefusal, string> = {
  malformed: 'The bearer token is not a StoryBook token.',
  unknown: 'The bearer token is not recognised.',
  expired: 'The bearer token has expired.',
  revoked: 'The bearer token was revoked.',
};

/**
 * Bearer token → connection → user, team and scopes → a principal whose
 * Supabase client runs as that user (EDD "5. Authentication and tenancy").
 *
 * Every call does all of it again: the token is looked up (so a revocation
 * takes effect on the next call), a fresh 5-minute JWT is minted, and the
 * user's membership of the connection's team is re-checked.
 */
export async function withMcpAuth(
  request: Request,
  deps: McpAuthDeps,
): Promise<McpAuthResult> {
  const token = bearerToken(request);

  if (!token) {
    return refused(
      401,
      'UNAUTHORIZED',
      'Send the token as "Authorization: Bearer <token>".',
    );
  }

  const verified = await deps.verifier.verify(token);

  if (!verified.ok) {
    return refused(401, 'UNAUTHORIZED', REFUSALS[verified.reason], {
      reason: verified.reason,
    });
  }

  const { connection } = verified;

  const jwt = await deps.signer.sign({
    userId: connection.userId,
    connectionId: connection.id,
  });

  const supabase = deps.createUserClient(jwt);
  const checkMembership = deps.checkMembership ?? defaultCheckMembership;

  if (!(await checkMembership(supabase, connection.accountId))) {
    return refused(
      403,
      'FORBIDDEN',
      'You are no longer a member of the team this connection is bound to.',
    );
  }

  if (deps.touchConnection) {
    try {
      await deps.touchConnection(connection.id);
    } catch (error) {
      console.error('[studio-mcp] could not record last_used_at', error);
    }
  }

  return {
    ok: true,
    principal: {
      userId: connection.userId,
      accountId: connection.accountId,
      connectionId: connection.id,
      scopes: connection.scopes,
      clientName: connection.clientName,
      supabase,
    },
  };
}

async function defaultCheckMembership(
  client: SupabaseClient<Database>,
  accountId: string,
) {
  const { data, error } = await client.rpc('has_role_on_account', {
    account_id: accountId,
  });

  if (error) {
    // A JWT PostgREST rejects (wrong SUPABASE_JWT_SECRET) surfaces here, as
    // a 401 from the database, and must not read as "not a member".
    throw new Error(
      `membership check failed (${error.code ?? 'unknown'}): ${error.message}`,
    );
  }

  return data === true;
}

function refused(
  status: 401 | 403,
  code: 'UNAUTHORIZED' | 'FORBIDDEN',
  message: string,
  details?: Record<string, unknown>,
): McpAuthResult {
  return {
    ok: false,
    status,
    error: new McpToolError(code, message, { details }),
  };
}
