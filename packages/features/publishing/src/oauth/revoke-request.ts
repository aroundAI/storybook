import 'server-only';

/**
 * What asking a platform to revoke our access came to. Logged on every
 * disconnect; never shown to the user, who is told what the dialog promised
 * (see `disconnect-copy.ts`) whatever the platform answered.
 */
export type RevokeStatus =
  /** The platform answered 2xx. */
  | 'revoked'
  /** The platform answered, and not with 2xx: token already dead, or refused. */
  | 'vendor_refused'
  /** No answer: network failure or the timeout. */
  | 'unreachable'
  /** Nothing to revoke: the row held no token. */
  | 'no_token'
  /** The stored token could not be decrypted. */
  | 'undecryptable'
  /** The app's own client credentials for the platform are missing. */
  | 'not_configured'
  /** This platform has no revoke call yet (X and LinkedIn — KB-25). */
  | 'not_implemented';

export interface RevokeOutcome {
  status: RevokeStatus;
  httpStatus?: number;
}

/** A platform's revoke call, given the decrypted access token. */
export type Revoker = (accessToken: string) => Promise<RevokeOutcome>;

/**
 * Long enough for a slow vendor, short enough that a hung one cannot hold the
 * disconnect dialog open: the revoke is best effort and the disconnect goes
 * ahead whatever it returns.
 */
export const REVOKE_TIMEOUT_MS = 10_000;

/**
 * Makes the revoke request and reads its answer. Before KB-22 the response
 * was never read, so a 400 from the platform looked exactly like success
 * (KB-45).
 */
export async function requestRevocation(
  url: string,
  init: RequestInit,
): Promise<RevokeOutcome> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });

    return {
      status: response.ok ? 'revoked' : 'vendor_refused',
      httpStatus: response.status,
    };
  } catch {
    return { status: 'unreachable' };
  }
}
