import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import { getLogger } from '@kit/shared/logger';

import {
  CONNECT_FAILURE_LANDING,
  ConnectFailureCode,
  ConnectPlatform,
  VENDOR_CODE_MAX_LENGTH,
  VENDOR_LOG_ID_MAX_LENGTH,
  VENDOR_MESSAGE_MAX_LENGTH,
  accountIdFromUnverifiedState,
  cleanVendorText,
  connectFailureQuery,
  failureCodeForVendorError,
  isUuid,
} from './connect-failure';

/** The message every failed connect is logged under. Named in the runbook. */
export const CONNECT_FAILED_LOG_MESSAGE = 'Platform connect failed';

const CAUSE_MAX_LENGTH = 300;

const SECRET_PARAMETER =
  /\b(access_token|refresh_token|id_token|fb_exchange_token|client_secret|client_key|code_verifier|code|state|authorization)(["']?\s*[=:]\s*["']?)(?:(?:bearer|basic)\s+)?[^\s&"',}]+/gi;

/** Blanks anything shaped like a credential inside a string we did not write. */
export function redactSecrets(text: string) {
  return text.replace(SECRET_PARAMETER, '$1$2[redacted]');
}

/** Untrusted text, fit to log and to put in a URL. */
function vendorText(value: unknown, maxLength: number) {
  return typeof value === 'string' || typeof value === 'number'
    ? cleanVendorText(redactSecrets(String(value)), maxLength)
    : null;
}

function loggable(value: unknown) {
  return vendorText(value, CAUSE_MAX_LENGTH);
}

/**
 * The loggable part of whatever a failure branch caught: an error's name,
 * code and message — never the object itself, which for a token response
 * is the tokens.
 */
function describeCause(cause: unknown) {
  if (cause === undefined || cause === null) {
    return undefined;
  }

  if (typeof cause !== 'object') {
    return { message: loggable(cause) };
  }

  const { name, code, message } = cause as Record<string, unknown>;

  return {
    name: loggable(name),
    code: loggable(code),
    message: loggable(message),
  };
}

/** What a failure branch says about itself; the rest is the callback's. */
export interface CallbackFailure {
  /** Our name for the failure; what the page looks its message up by. */
  code: ConnectFailureCode;
  /** Which branch of the callback gave up — finer than `code`. */
  branch: string;
  /** What the vendor said, verbatim. Logged and shown as untrusted text. */
  vendor?: { error?: unknown; description?: unknown; logId?: unknown };
  /** A caught error or a vendor's error object. Only its message is kept. */
  cause?: unknown;
  /** The HTTP status of a vendor call that failed. */
  status?: number;
}

/** The failure a vendor reported by redirecting back with `error=`. */
export function vendorRefusal(
  error: string,
  searchParams: URLSearchParams,
): CallbackFailure {
  return {
    code: failureCodeForVendorError(error),
    branch: 'vendor_refused',
    vendor: {
      error,
      description: searchParams.get('error_description'),
      // TikTok's reference for a failed authorise, which its support asks for.
      logId: searchParams.get('log_id'),
    },
  };
}

interface FailConnectParams extends CallbackFailure {
  request: { nextUrl: { origin: string } };
  platform: ConnectPlatform;
  /** The account the connect was for, when the callback knows or can guess. */
  accountId?: string | null;
}

/**
 * The one way an OAuth callback gives up (KB-19): write one log line, then
 * send the person to a page that says what happened.
 *
 * Takes the parts it may log rather than the request's parameters, so the
 * authorisation code, the state and the tokens are never in reach.
 */
export async function failConnect(params: FailConnectParams) {
  const logger = await getLogger();

  const vendorCode = vendorText(params.vendor?.error, VENDOR_CODE_MAX_LENGTH);
  const vendorMessage = vendorText(
    params.vendor?.description,
    VENDOR_MESSAGE_MAX_LENGTH,
  );
  const vendorLogId = vendorText(
    params.vendor?.logId,
    VENDOR_LOG_ID_MAX_LENGTH,
  );
  const accountId = isUuid(params.accountId) ? params.accountId : null;

  logger.error(
    {
      name: `oauth.${params.platform}.callback`,
      platform: params.platform,
      code: params.code,
      branch: params.branch,
      accountId,
      vendorError: vendorCode,
      vendorErrorDescription: vendorMessage,
      vendorLogId,
      status: params.status,
      cause: describeCause(params.cause),
    },
    CONNECT_FAILED_LOG_MESSAGE,
  );

  const query = connectFailureQuery({
    code: params.code,
    platform: params.platform,
    vendorCode,
    vendorMessage,
    vendorLogId,
  });

  if (accountId) {
    query.set('account', accountId);
  }

  return NextResponse.redirect(
    new URL(`${CONNECT_FAILURE_LANDING}?${query}`, appOrigin(params.request)),
  );
}

/**
 * Wraps a callback so that a throw — a vendor answering with HTML, a network
 * error mid-exchange — ends on the same page as every other failure instead
 * of a bare 500.
 */
export function catchConnectFailures(
  platform: ConnectPlatform,
  handler: (request: NextRequest) => Promise<NextResponse>,
) {
  return async (request: NextRequest) => {
    try {
      return await handler(request);
    } catch (cause) {
      return failConnect({
        request,
        platform,
        code: 'unexpected',
        branch: 'uncaught',
        accountId: accountIdFromUnverifiedState(
          request.nextUrl.searchParams.get('state'),
        ),
        cause,
      });
    }
  };
}

/**
 * The origin failures are sent to: the configured one, so that a Host header
 * cannot choose it. The request's own origin only when nothing is configured,
 * which is a development machine.
 */
export function appOrigin(request: FailConnectParams['request']) {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;

  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed setting must not turn a failure into a 500.
    }
  }

  return request.nextUrl.origin;
}
