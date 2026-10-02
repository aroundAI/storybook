import 'server-only';

/**
 * What asking a platform to revoke our access came to. Logged on every
 * disconnect, and returned to the dialog: anything but a confirmed revoke
 * gets the creator a warning that links to the platform's own settings
 * (KB-45).
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
  /**
   * The platform gives apps no way to revoke their own access (KB-25; no
   * supported platform today). There is deliberately no "not yet" status:
   * every platform either revokes or records that its vendor offers nothing.
   */
  | 'vendor_offers_none';

export interface RevokeOutcome {
  status: RevokeStatus;
  httpStatus?: number;
}

/**
 * Whether the platform confirmed it holds no usable grant for us: it said so,
 * or we held no token to begin with. Anything else, the creator is told to
 * check at the platform.
 */
export function isRevokeConfirmed(status: RevokeStatus): boolean {
  return status === 'revoked' || status === 'no_token';
}

/** The decrypted tokens a connection holds. */
export interface RevokeTokens {
  accessToken: string;
  refreshToken: string | null;
}

/** A platform's revoke call. */
export type Revoker = (tokens: RevokeTokens) => Promise<RevokeOutcome>;

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
  send: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<RevokeOutcome> {
  try {
    const response = await send(url, {
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
