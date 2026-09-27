import { describe, expect, it } from 'vitest';

import {
  generateCodeChallenge,
  generateCodeVerifier,
} from '../src/oauth/tiktok/config';

/**
 * FILM-706. TikTok's connect sends an S256 PKCE challenge, and the callback
 * sends the verifier back. RFC 7636 fixes both shapes.
 */

describe('PKCE code verifier', () => {
  it('is 43 characters of the unreserved URL-safe alphabet (RFC 7636 §4.1)', () => {
    const verifier = generateCodeVerifier();

    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(verifier).toHaveLength(43);
  });

  it('is different every time', () => {
    const verifiers = new Set(
      Array.from({ length: 20 }, () => generateCodeVerifier()),
    );

    expect(verifiers.size).toBe(20);
  });
});

describe('PKCE code challenge', () => {
  it('is BASE64URL(SHA-256(verifier)), matching RFC 7636 Appendix B', async () => {
    await expect(
      generateCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    ).resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('has no padding and no characters a URL would escape', async () => {
    const challenge = await generateCodeChallenge(generateCodeVerifier());

    expect(challenge).toMatch(/^[A-Za-z0-9\-_]{43}$/);
  });
});
