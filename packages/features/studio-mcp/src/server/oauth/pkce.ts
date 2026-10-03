import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * PKCE (RFC 7636), S256 only: the client sends
 * `code_challenge = base64url(sha256(code_verifier))` at /oauth/authorize
 * and the verifier at /oauth/token; only the party that generated the
 * verifier can redeem the code, so a code intercepted on its way back
 * through the user agent is worthless.
 */
const VERIFIER_SHAPE = /^[A-Za-z0-9._~-]{43,128}$/;
const CHALLENGE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function isCodeChallengeShape(challenge: string) {
  return CHALLENGE_SHAPE.test(challenge);
}

export function isCodeVerifierShape(verifier: string) {
  return VERIFIER_SHAPE.test(verifier);
}

export function codeChallengeFor(verifier: string) {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function verifyPkce(verifier: string, challenge: string) {
  if (!isCodeVerifierShape(verifier) || !isCodeChallengeShape(challenge)) {
    return false;
  }

  const expected = Buffer.from(codeChallengeFor(verifier), 'ascii');
  const presented = Buffer.from(challenge, 'ascii');

  return (
    expected.length === presented.length && timingSafeEqual(expected, presented)
  );
}
