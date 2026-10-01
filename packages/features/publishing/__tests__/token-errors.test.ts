import { describe, expect, it } from 'vitest';

import { ActionRefusal } from '@kit/next/action-result';

import { PLATFORMS, PLATFORM_NAMES } from '../src/lib/platforms';
import {
  TOKEN_ERROR_CODES,
  type TokenErrorCode,
  TokenRefusal,
  isTokenErrorCode,
  readableTokenError,
  tokenErrorCodeOf,
  tokenErrorMessage,
} from '../src/lib/token-errors';

/**
 * KB-157. A publish refused at the token check showed the person the bare
 * code (`NO_REFRESH_TOKEN`). Every code now reads as one sentence: what
 * happened, and what to do.
 */
const YOUTUBE: Record<TokenErrorCode, string> = {
  NOT_FOUND:
    'This YouTube connection no longer exists. Connect YouTube in Settings → Platforms to publish.',
  CONNECTION_INACTIVE:
    'Your YouTube connection has stopped working. Reconnect YouTube in Settings → Platforms to publish.',
  NO_REFRESH_TOKEN:
    'Your YouTube connection has expired. Reconnect YouTube in Settings → Platforms to publish.',
  REFRESH_FAILED:
    "YouTube didn't renew your connection. Reconnect YouTube in Settings → Platforms to publish.",
  EXPIRED:
    'Your YouTube connection is due for renewal, which happens within 30 minutes. Try again then, or reconnect YouTube in Settings → Platforms to publish now.',
  NO_ACCESS_TOKEN:
    'Your YouTube connection has no sign-in saved. Reconnect YouTube in Settings → Platforms to publish.',
  TOKEN_UNREADABLE:
    "This app can't read your saved YouTube sign-in. Reconnect YouTube in Settings → Platforms to publish.",
  APP_NOT_CONFIGURED:
    "Publishing to YouTube isn't set up yet: this app has no YouTube credentials. Your connection still works; ask your administrator to add them.",
};

describe('tokenErrorMessage (KB-157)', () => {
  it.each(TOKEN_ERROR_CODES)('words %s as a sentence', (code) => {
    expect(tokenErrorMessage(code, 'youtube')).toBe(YOUTUBE[code]);
  });

  it.each(TOKEN_ERROR_CODES)(
    'never shows %s, or any code, to the person',
    (code) => {
      for (const platform of PLATFORMS) {
        const sentence = tokenErrorMessage(code, platform);

        expect(sentence).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
        expect(sentence).toContain(PLATFORM_NAMES[platform]);
        expect(sentence).not.toMatch(/sorry|please/i);
      }
    },
  );

  it('names X as X, not twitter', () => {
    expect(tokenErrorMessage('NO_REFRESH_TOKEN', 'twitter')).toBe(
      'Your X connection has expired. Reconnect X in Settings → Platforms to publish.',
    );
  });
});

describe('readableTokenError', () => {
  it('words a bare code stored before KB-157', () => {
    expect(readableTokenError('CONNECTION_INACTIVE', 'youtube')).toBe(
      YOUTUBE.CONNECTION_INACTIVE,
    );
  });

  it('leaves any other stored text as it is', () => {
    expect(readableTokenError('Video too long for Shorts', 'youtube')).toBe(
      'Video too long for Shorts',
    );
  });
});

describe('TokenRefusal', () => {
  it('is a refusal the page reads, carrying the code for support', () => {
    const refusal = new TokenRefusal('NO_REFRESH_TOKEN', 'youtube');

    expect(refusal).toBeInstanceOf(ActionRefusal);
    expect(refusal.message).toBe(YOUTUBE.NO_REFRESH_TOKEN);
    expect(tokenErrorCodeOf(refusal)).toBe('NO_REFRESH_TOKEN');
  });

  it('has no code for any other error', () => {
    expect(tokenErrorCodeOf(new Error('NO_REFRESH_TOKEN'))).toBeUndefined();
    expect(isTokenErrorCode('Unknown error')).toBe(false);
  });
});
