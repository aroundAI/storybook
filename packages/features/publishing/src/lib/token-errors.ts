import { ActionRefusal } from '@kit/next/action-result';

import { PLATFORM_NAMES, isPlatform } from './platforms';

/**
 * Why a connection's token could not be used (KB-157). The code is for logs
 * and support; the person publishing reads `tokenErrorMessage`, never the
 * code. Pure, so client code and the worker lambdas can import it.
 */
export const TOKEN_ERROR_CODES = [
  'NOT_FOUND',
  'CONNECTION_INACTIVE',
  'NO_REFRESH_TOKEN',
  'REFRESH_FAILED',
  /** Due for renewal, and the cron has not renewed it yet (KB-15). */
  'EXPIRED',
  'NO_ACCESS_TOKEN',
  'TOKEN_UNREADABLE',
  /** An operator fault: the connection is left active (KB-29). */
  'APP_NOT_CONFIGURED',
  /** A kept row on a platform the product removed (FILM-717): nothing is sent. */
  'PLATFORM_UNSUPPORTED',
] as const;

export type TokenErrorCode = (typeof TOKEN_ERROR_CODES)[number];

const SETTINGS = 'Settings → Platforms';

const SENTENCES: Record<TokenErrorCode, (name: string) => string> = {
  NOT_FOUND: (name) =>
    `This ${name} connection no longer exists. Connect ${name} in ${SETTINGS} to publish.`,
  CONNECTION_INACTIVE: (name) =>
    `Your ${name} connection has stopped working. Reconnect ${name} in ${SETTINGS} to publish.`,
  NO_REFRESH_TOKEN: (name) =>
    `Your ${name} connection has expired. Reconnect ${name} in ${SETTINGS} to publish.`,
  REFRESH_FAILED: (name) =>
    `${name} didn't renew your connection. Reconnect ${name} in ${SETTINGS} to publish.`,
  EXPIRED: (name) =>
    `Your ${name} connection is due for renewal, which happens within 30 minutes. Try again then, or reconnect ${name} in ${SETTINGS} to publish now.`,
  NO_ACCESS_TOKEN: (name) =>
    `Your ${name} connection has no sign-in saved. Reconnect ${name} in ${SETTINGS} to publish.`,
  TOKEN_UNREADABLE: (name) =>
    `This app can't read your saved ${name} sign-in. Reconnect ${name} in ${SETTINGS} to publish.`,
  APP_NOT_CONFIGURED: (name) =>
    `Publishing to ${name} isn't set up yet: this app has no ${name} credentials. Your connection still works; ask your administrator to add them.`,
  PLATFORM_UNSUPPORTED: (name) =>
    `This app no longer publishes to ${name}, so nothing was sent.`,
};

function platformName(platform: string): string {
  return isPlatform(platform) ? PLATFORM_NAMES[platform] : platform;
}

export function isTokenErrorCode(value: unknown): value is TokenErrorCode {
  return (TOKEN_ERROR_CODES as readonly unknown[]).includes(value);
}

/** The one sentence a person reads for a token code: what happened, and what to do. */
export function tokenErrorMessage(
  code: TokenErrorCode,
  platform: string,
): string {
  return SENTENCES[code](platformName(platform));
}

/**
 * Stored failure text as the person should read it. A row written before
 * KB-157 holds the bare code; anything else is already a sentence.
 */
export function readableTokenError(stored: string, platform: string): string {
  return isTokenErrorCode(stored)
    ? tokenErrorMessage(stored, platform)
    : stored;
}

/**
 * A publish refused at the token check. Returned to the page as its
 * sentence (production redacts thrown text); `code` goes to logs and the
 * stored record.
 */
export class TokenRefusal extends ActionRefusal {
  override name = 'TokenRefusal';

  constructor(
    readonly code: TokenErrorCode,
    platform: string,
  ) {
    super(tokenErrorMessage(code, platform));
  }
}

/** The token code an error carries, if it is a token refusal. */
export function tokenErrorCodeOf(error: unknown): TokenErrorCode | undefined {
  return error instanceof TokenRefusal ? error.code : undefined;
}
