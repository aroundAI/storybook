import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decrypt, encrypt, isEncrypted } from '../src/crypto';

/**
 * These tests moved here from `@kit/publishing`, whose own `src/lib/crypto.ts`
 * was deleted as dead code in 96c9e20e once every caller had switched to
 * `@kit/shared/crypto`. The test file was left behind importing a module that
 * no longer existed, so it failed to load; meanwhile the module that actually
 * encrypts OAuth access and refresh tokens had no tests at all.
 */

// 32 bytes, the only length getEncryptionKey() accepts.
const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

describe('crypto', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalKey;
    }
  });

  describe('encrypt / decrypt round trip', () => {
    it('should recover the original plaintext', async () => {
      const plaintext = 'ya29.a0AfB_byC-oauth-access-token';

      expect(await decrypt(await encrypt(plaintext))).toBe(plaintext);
    });

    it('should round trip an empty string', async () => {
      expect(await decrypt(await encrypt(''))).toBe('');
    });

    it('should round trip multi-byte characters', async () => {
      const plaintext = 'refresh—토큰—🔐';

      expect(await decrypt(await encrypt(plaintext))).toBe(plaintext);
    });

    it('should round trip a value longer than one AES block', async () => {
      const plaintext = 'x'.repeat(5000);

      expect(await decrypt(await encrypt(plaintext))).toBe(plaintext);
    });

    it('should produce a different ciphertext each time', async () => {
      const plaintext = 'same-token-twice';

      const first = await encrypt(plaintext);
      const second = await encrypt(plaintext);

      // A fresh random IV per call, so identical tokens must not encrypt to
      // identical rows — otherwise the database leaks which users share one.
      expect(first).not.toBe(second);
      expect(await decrypt(first)).toBe(plaintext);
      expect(await decrypt(second)).toBe(plaintext);
    });
  });

  describe('decrypt', () => {
    it('should reject data too short to hold an IV and tag', async () => {
      const tooShort = Buffer.alloc(20).toString('base64');

      await expect(decrypt(tooShort)).rejects.toThrow('too short');
    });

    it('should reject a tampered ciphertext', async () => {
      const encrypted = await encrypt('sensitive');
      const bytes = Buffer.from(encrypted, 'base64');

      // Flip a bit in the ciphertext body, past the 12-byte IV. GCM
      // authenticates, so this must fail rather than return garbage.
      const last = bytes.length - 1;
      bytes[last] = (bytes[last] ?? 0) ^ 0xff;

      await expect(decrypt(bytes.toString('base64'))).rejects.toThrow();
    });

    it('should not decrypt with a different key', async () => {
      const encrypted = await encrypt('sensitive');

      process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

      await expect(decrypt(encrypted)).rejects.toThrow();
    });
  });

  describe('key validation', () => {
    it('should throw when ENCRYPTION_KEY is missing', async () => {
      delete process.env.ENCRYPTION_KEY;

      await expect(encrypt('value')).rejects.toThrow(
        'ENCRYPTION_KEY environment variable is required',
      );
    });

    it('should throw when the key is not 32 bytes', async () => {
      process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');

      await expect(encrypt('value')).rejects.toThrow(
        'must be exactly 32 bytes',
      );
    });
  });

  describe('isEncrypted', () => {
    it('should accept output of encrypt()', async () => {
      expect(await isEncrypted(await encrypt('token'))).toBe(true);
    });

    it('should reject a plaintext token', async () => {
      expect(await isEncrypted('ya29.short')).toBe(false);
    });

    it('should reject an empty string', async () => {
      expect(await isEncrypted('')).toBe(false);
    });
  });
});
