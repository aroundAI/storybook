import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  decrypt,
  encrypt,
  generateEncryptionKey,
  validateEncryptionConfig,
} from '../src/lib/crypto';

describe('Crypto Module', () => {
  const validKey =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', validKey);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt a string correctly', async () => {
      const plaintext = 'my-secret-oauth-token';

      const encrypted = await encrypt(plaintext);
      const decrypted = await decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext (due to random IV)', async () => {
      const plaintext = 'my-secret-token';

      const encrypted1 = await encrypt(plaintext);
      const encrypted2 = await encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to the same value
      expect(await decrypt(encrypted1)).toBe(plaintext);
      expect(await decrypt(encrypted2)).toBe(plaintext);
    });

    it('should handle empty strings', async () => {
      const plaintext = '';

      const encrypted = await encrypt(plaintext);
      const decrypted = await decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle long strings', async () => {
      const plaintext = 'a'.repeat(10000);

      const encrypted = await encrypt(plaintext);
      const decrypted = await decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle special characters', async () => {
      const plaintext = 'token/with+special=chars&more%stuff';

      const encrypted = await encrypt(plaintext);
      const decrypted = await decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle unicode characters', async () => {
      const plaintext = 'token-with-emoji-🎉-and-日本語';

      const encrypted = await encrypt(plaintext);
      const decrypted = await decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should fail to decrypt with wrong key', async () => {
      const plaintext = 'my-secret-token';
      const encrypted = await encrypt(plaintext);

      // Change the key
      const newKey =
        'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', newKey);

      await expect(decrypt(encrypted)).rejects.toThrow();
    });

    it('should fail to decrypt corrupted data', async () => {
      const corrupted = 'not-valid-base64-encrypted-data!@#$';

      await expect(decrypt(corrupted)).rejects.toThrow();
    });

    it('should fail to decrypt truncated data', async () => {
      const plaintext = 'my-secret-token';
      const encrypted = await encrypt(plaintext);

      // Truncate the encrypted data
      const truncated = encrypted.substring(0, encrypted.length - 10);

      await expect(decrypt(truncated)).rejects.toThrow();
    });
  });

  describe('generateEncryptionKey', () => {
    it('should generate a 64-character hex string', () => {
      const key = generateEncryptionKey();

      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should generate unique keys', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();

      expect(key1).not.toBe(key2);
    });

    it('should generate keys that work for encryption', async () => {
      const key = generateEncryptionKey();
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', key);

      const plaintext = 'test-token';
      const encrypted = await encrypt(plaintext);
      const decrypted = await decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('validateEncryptionConfig', () => {
    it('should return true with valid key', () => {
      expect(validateEncryptionConfig()).toBe(true);
    });

    it('should throw when key is missing', () => {
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');

      expect(() => validateEncryptionConfig()).toThrow(
        'TOKEN_ENCRYPTION_KEY environment variable is not configured',
      );
    });

    it('should throw when key is wrong length', () => {
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'too-short');

      expect(() => validateEncryptionConfig()).toThrow(
        /must be exactly 32 bytes/,
      );
    });

    it('should accept raw 32-byte string key', () => {
      // 32 ASCII characters
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', '01234567890123456789012345678901');

      expect(validateEncryptionConfig()).toBe(true);
    });
  });

  describe('key handling', () => {
    it('should work with hex-encoded key', async () => {
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', validKey);

      const plaintext = 'test';
      const encrypted = await encrypt(plaintext);
      const decrypted = await decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should work with raw 32-byte key', async () => {
      const rawKey = '01234567890123456789012345678901';
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', rawKey);

      const plaintext = 'test';
      const encrypted = await encrypt(plaintext);
      const decrypted = await decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });
});
